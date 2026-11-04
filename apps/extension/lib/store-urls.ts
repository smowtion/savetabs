/**
 * Browser extension store listing URLs.
 *
 * SaveTabs is not published yet, so both entries below are placeholders. When
 * the store listings go live, replace the two IDs here; every call site keeps
 * working unchanged. The URLs are kept in one place so the Chrome and Firefox
 * values can never drift apart.
 */

/** Browsers with a distributable build of the extension. */
export type StoreBrowser = "chrome" | "firefox";

/** Placeholder store listings, keyed by the browser that owns them. */
export const STORE_LISTING_URLS: Readonly<Record<StoreBrowser, string>> = {
  chrome: "https://chromewebstore.google.com/detail/savetabs-placeholder",
  firefox: "https://addons.mozilla.org/firefox/addon/savetabs-placeholder/",
};
