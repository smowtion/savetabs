import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";

export const CORS_ALLOW_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
export const CORS_ALLOW_HEADERS = "Authorization, Content-Type";
/**
 * Cache preflights for a day. Every authorized request carries a
 * non-safelisted Authorization header, so an uncached preflight would double
 * the Worker request count for each API call.
 */
export const CORS_MAX_AGE_SECONDS = 86_400;

/**
 * Browser origins allowed to call the API:
 * - the web app origin from `WEB_ORIGIN`;
 * - Chrome, Firefox and Safari extension pages. Extension origins are opaque
 *   and per-install, so they cannot be listed in configuration; the API does
 *   not use cookies, so reflecting these origins is safe.
 */
export function isAllowedOrigin(origin: string, webOrigin: string): boolean {
  if (origin === webOrigin) return true;
  return /^(chrome|moz|safari|safari-web)-extension:\/\/[A-Za-z0-9._-]+$/.test(
    origin,
  );
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
      c.header("Access-Control-Max-Age", String(CORS_MAX_AGE_SECONDS));
    }
    return c.body(null, 204);
  }

  await next();
};
