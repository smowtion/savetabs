/**
 * Incognito access helpers.
 *
 * The extension only sees private windows after the user explicitly allows it
 * in the browser's extension settings. `extension.isAllowedIncognitoAccess`
 * reports that decision; a missing API or a rejected call is treated as "not
 * allowed" so the options UI never promises behavior the browser will not
 * deliver.
 */

import { browser } from "wxt/browser";

/**
 * Extensions page shown to the user as selectable text. Navigating to these
 * privileged schemes is blocked for extensions, so the UI never creates a tab
 * from this value; it only renders it and copies it to the clipboard.
 */
export const EXTENSIONS_PAGE_PATH =
  import.meta.env.BROWSER === "firefox" ? "about:addons" : "chrome://extensions";

/**
 * Resolve whether the user allowed SaveTabs in incognito windows.
 *
 * Any failure (no API, rejection, non-true answer) reports no access. This is
 * the conservative answer: the UI disables incognito saving instead of
 * offering a control the browser would silently ignore.
 */
export async function isIncognitoAllowed(): Promise<boolean> {
  const extensionApi = (
    browser as unknown as {
      extension?: { isAllowedIncognitoAccess?: () => Promise<boolean> };
    }
  ).extension;
  const check = extensionApi?.isAllowedIncognitoAccess;
  if (typeof check !== "function") return false;

  try {
    return (await check.call(extensionApi)) === true;
  } catch {
    return false;
  }
}
