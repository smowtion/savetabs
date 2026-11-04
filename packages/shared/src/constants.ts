/** Product name shared by the extension, web app and API. */
export const APP_NAME = "SaveTabs";

/**
 * Hard limits shared by the extension, sync client and Cloudflare Worker.
 * Values are pinned by tests; changing them is a protocol change.
 */
export const LIMITS = {
  /** Maximum size of one encrypted session blob (256 KiB). */
  maxSessionBytes: 256 * 1024,
  /** Maximum tabs accepted in one session; the rest stay open. */
  maxTabsPerSession: 500,
  /** Maximum sessions stored per sync key. */
  maxSessionsPerKey: 200,
  /** Maximum total blob size stored per sync key (5 MiB). */
  maxKeyBytes: 5 * 1024 * 1024,
  /** Local IndexedDB session cap before saving is blocked. */
  maxLocalSessions: 500,
  /** Local IndexedDB tab cap before saving is blocked. */
  maxLocalTabs: 15000,
} as const;
