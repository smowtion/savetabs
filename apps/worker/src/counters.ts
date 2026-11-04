import type { MiddlewareHandler } from "hono";
import type { Env, RateLimiterBinding } from "./env";
import { apiError, type AppContext } from "./errors";

/** Fallbacks used when a Wrangler var is missing or not a positive number. */
export const DEFAULT_DAILY_REQUESTS = 100_000;
export const DEFAULT_MAX_KEYS = 1_000;

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

/**
 * Ask a rate-limiter binding whether the key is still within its configured
 * budget. Limiter errors fail open so an outage of the binding does not take
 * the API down with it.
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

/**
 * Per-IP limiting runs before authentication so unauthenticated floods are
 * rejected as early as possible. The bucket uses the client address and is a
 * no-op when the binding is absent.
 */
export const ipRateLimitMiddleware: MiddlewareHandler<{ Bindings: Env }> =
  async (c, next) => {
    const limiter = c.env.RATE_LIMITER_IP;
    if (limiter === undefined) {
      await next();
      return;
    }

    if (!(await allowRequest(limiter, [`ip:${clientIp(c)}`]))) {
      return apiError(
        c,
        429,
        "rate_limited",
        "Too many requests; slow down and retry shortly.",
      );
    }

    await next();
  };

/**
 * Charge the per-authId bucket. Callers must invoke this only after the bearer
 * has been verified: keying the bucket from the public path would let an
 * unauthenticated caller spend another key's budget. A no-op when the binding
 * is absent.
 *
 * Returns a 429 response when the bucket is exhausted, otherwise `null`.
 */
export async function enforceAuthRateLimit(
  c: AppContext,
  authId: string,
): Promise<Response | null> {
  const limiter = c.env.RATE_LIMITER_AUTH;
  if (limiter === undefined) return null;

  if (await allowRequest(limiter, [`auth:${authId}`])) return null;

  return apiError(
    c,
    429,
    "rate_limited",
    "Too many requests; slow down and retry shortly.",
  );
}
