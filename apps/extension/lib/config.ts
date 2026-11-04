/**
 * Build-time configuration for the extension.
 *
 * `WXT_SAVETABS_API_BASE` is the canonical deployment variable. WXT exposes
 * `WXT_`-prefixed variables through `import.meta.env`, and `wxt.config.ts`
 * also injects the resolved origin with Vite `define`, so the manifest host
 * permission and this runtime value can never disagree. The placeholder below
 * keeps development builds running without pointing at a real account.
 */

const DEFAULT_API_BASE = "https://api.savetabs.example";

/** Sync API origin, normalized without a trailing slash. */
export const API_BASE = (
  (import.meta.env.WXT_SAVETABS_API_BASE as string | undefined) ??
  DEFAULT_API_BASE
).replace(/\/+$/, "");
