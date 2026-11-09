/**
 * Browser extension store listing URLs.
 *
 * Chrome and Firefox listings are live. Keeping both values in one place
 * means the update banner can never drift from the landing page.
 */

/** Browsers with a distributable build of the extension. */
export type StoreBrowser = "chrome" | "firefox";

/** Store listings, keyed by the browser that owns them. */
export const STORE_LISTING_URLS: Readonly<Record<StoreBrowser, string>> = {
  chrome: "https://chromewebstore.google.com/detail/ajejilnkhplcpgcjfkidkdepjipmocfi",
  firefox: "https://addons.mozilla.org/firefox/addon/save_tabs/",
};
