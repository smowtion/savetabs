/**
 * Browser extension store listing URLs.
 *
 * The Chrome Web Store item is live (pending review at first submission); the
 * Firefox Add-ons entry is still a placeholder until AMO submission. Replace
 * the Firefox ID when that listing exists; every call site keeps working
 * unchanged. The URLs are kept in one place so the two values can never drift
 * apart.
 */

/** Browsers with a distributable build of the extension. */
export type StoreBrowser = "chrome" | "firefox";

/** Store listings, keyed by the browser that owns them. */
export const STORE_LISTING_URLS: Readonly<Record<StoreBrowser, string>> = {
  chrome: "https://chromewebstore.google.com/detail/ajejilnkhplcpgcjfkidkdepjipmocfi",
  firefox: "https://addons.mozilla.org/firefox/addon/savetabs-placeholder/",
};
