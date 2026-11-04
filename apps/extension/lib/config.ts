/**
 * Build-time configuration for the extension.
 *
 * WXT exposes environment variables prefixed with `WXT_` through
 * `import.meta.env`. Deployments set `WXT_SAVETABS_API_BASE` to the Worker
 * origin; the placeholder below keeps development builds running without
 * pointing at a real account. `wxt.config.ts` derives the manifest host
 * permission from the same origin (via `SAVETABS_API_BASE`).
 */

const DEFAULT_API_BASE = "https://api.savetabs.example";

/** Sync API origin, normalized without a trailing slash. */
export const API_BASE = (
  (import.meta.env.WXT_SAVETABS_API_BASE as string | undefined) ??
  DEFAULT_API_BASE
).replace(/\/+$/, "");
