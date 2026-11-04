/**
 * URL helpers shared by the extension and the web app.
 *
 * Saved tabs can only be reopened as browser tabs when they use one of the
 * schemes below. Everything else (chrome://, about:, javascript:, ftp:, …) is
 * kept out of sessions and rendered as plain text when it appears in data
 * imported or decrypted from another source.
 */

/** Schemes that can be opened as a normal browser tab. */
const RESTORABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  "http:",
  "https:",
  "file:",
]);

/** True when `url` parses and uses a restorable scheme. */
export function isRestorableUrl(url: string): boolean {
  try {
    return RESTORABLE_PROTOCOLS.has(new URL(url).protocol.toLowerCase());
  } catch {
    return false;
  }
}
