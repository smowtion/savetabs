import type { MiddlewareHandler } from "hono";
import type { Env, RateLimiterBinding } from "./env";
import { apiError, type AppContext } from "./errors";

/** Fallbacks used when a Wrangler var is missing or not a positive number. */
export const DEFAULT_DAILY_REQUESTS = 100_000;
export const DEFAULT_MAX_KEYS = 1_000;

/**
 * Deployment targets for the `RATE_LIMITER` binding. Cloudflare's binding
 * enforces one configured limit per namespace, so these are the values the
 * binding configuration (wrangler.toml) must use for each key prefix:
 * `ip:*` at 120 requests/minute and `auth:*` at 240 requests/minute.
 */
export const RATE_LIMIT_PER_IP = 120;
export const RATE_LIMIT_PER_AUTH_ID = 240;

/** UTC calendar day (`YYYY-MM-DD`), the primary key of the counters table. */
export function currentDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Parse a positive integer setting. Wrangler exposes `[vars]` as strings, so
 * `Number(undefined)`/`Number("")` must not accidentally disable a cap.
 */
export function parseLimit(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

/**
 * Increment today's request counter and report whether the cap is exceeded.
 *
 * Counter writes are best-effort: if D1 is unavailable the request is allowed
 * through (the cap is not "known exceeded"). The single upsert statement makes
 * the increment atomic under concurrent requests.
 */
export async function recordRequest(
  db: D1Database,
  cap: number,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO counters (day, requests, keys_created) VALUES (?, 1, 0)
         ON CONFLICT (day) DO UPDATE SET requests = counters.requests + 1
         RETURNING requests`,
      )
      .bind(currentDay(now))
      .first<{ requests: number }>();
    return row !== null && row.requests > cap;
  } catch {
    return false;
  }
}

/** Number of keys registered today, or 0 when the counter cannot be read. */
export async function keysCreatedToday(
  db: D1Database,
  now: number = Date.now(),
): Promise<number> {
  try {
    const row = await db
      .prepare("SELECT keys_created FROM counters WHERE day = ?")
      .bind(currentDay(now))
      .first<{ keys_created: number }>();
    return row?.keys_created ?? 0;
  } catch {
    return 0;
  }
}

/** Best-effort increment after a successful auto-registration. */
export async function recordKeyCreated(
  db: D1Database,
  now: number = Date.now(),
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO counters (day, requests, keys_created) VALUES (?, 0, 1)
         ON CONFLICT (day) DO UPDATE SET keys_created = counters.keys_created + 1`,
      )
      .bind(currentDay(now))
      .run();
  } catch {
    // A failed counter write must not fail an otherwise accepted upload.
  }
}

/** Client address used for the per-IP bucket. */
export function clientIp(c: AppContext): string {
  const connectingIp = c.req.header("cf-connecting-ip");
  if (connectingIp !== undefined && connectingIp.length > 0) {
    return connectingIp;
  }

  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded !== undefined) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }

  return "unknown";
}

/** Extract the `:authId` segment for the per-authId bucket. */
export function authIdFromPath(pathname: string): string | undefined {
  const match = /^\/v1\/keys\/([^/]+)/.exec(pathname);
  if (match?.[1] === undefined) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Ask the rate-limiter binding about every bucket. Any failed bucket rejects
 * the request. Limiter errors fail open so an outage of the binding does not
 * take the API down with it.
 */
export async function allowRequest(
  limiter: RateLimiterBinding,
  keys: readonly string[],
): Promise<boolean> {
  try {
    const results = await Promise.all(
      keys.map((key) => limiter.limit({ key })),
    );
    return results.every((result) => result.success);
  } catch {
    return true;
  }
}

/** Reject requests once today's global request budget is spent. */
export const capacityMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  const cap = parseLimit(c.env.GLOBAL_DAILY_REQUESTS, DEFAULT_DAILY_REQUESTS);

  if (await recordRequest(c.env.DB, cap)) {
    return apiError(
      c,
      429,
      "capacity_exceeded",
      "The daily request capacity has been reached.",
    );
  }

  await next();
};

/**
 * Per-IP and per-authId rate limiting. The binding is optional: local dev and
 * deployments without Cloudflare's rate limiting configured simply skip it.
 */
export const rateLimitMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  const limiter = c.env.RATE_LIMITER;
  if (limiter === undefined) {
    await next();
    return;
  }

  const keys = [`ip:${clientIp(c)}`];
  const authId = authIdFromPath(new URL(c.req.url).pathname);
  if (authId !== undefined) keys.push(`auth:${authId}`);

  if (!(await allowRequest(limiter, keys))) {
    return apiError(
      c,
      429,
      "rate_limited",
      "Too many requests; slow down and retry shortly.",
    );
  }

  await next();
};
