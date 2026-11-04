import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";

export const CORS_ALLOW_METHODS = "GET, PUT, DELETE, OPTIONS";
export const CORS_ALLOW_HEADERS = "Authorization, Content-Type";

/**
 * Browser origins allowed to call the API:
 * - the web app origin from `WEB_ORIGIN`;
 * - Chrome and Firefox extension pages. Extension origins are opaque and
 *   per-install, so they cannot be listed in configuration; the API does not
 *   use cookies, so reflecting these origins is safe.
 */
export function isAllowedOrigin(origin: string, webOrigin: string): boolean {
  if (origin === webOrigin) return true;
  return /^(chrome|moz)-extension:\/\/[A-Za-z0-9._-]+$/.test(origin);
}

/**
 * Echo the allowed origin and answer preflight requests before the capacity
 * and rate-limit middleware run, so a browser preflight is never rejected with
 * an API error.
 */
export const corsMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  const origin = c.req.header("origin");
  const allowOrigin =
    origin !== undefined && isAllowedOrigin(origin, c.env.WEB_ORIGIN)
      ? origin
      : undefined;

  c.header("Vary", "Origin");
  if (allowOrigin !== undefined) {
    c.header("Access-Control-Allow-Origin", allowOrigin);
  }

  if (c.req.method === "OPTIONS") {
    if (allowOrigin !== undefined) {
      c.header("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
      c.header("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
    }
    return c.body(null, 204);
  }

  await next();
};
