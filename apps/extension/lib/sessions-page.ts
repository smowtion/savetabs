/**
 * Sessions page helper shared by every entrypoint that opens the full-tab
 * sessions page.
 *
 * Save flow, toolbar action, context menus and keyboard commands all open the
 * same page. Keeping the tab lookup and the reuse/focus behavior here means
 * they cannot drift apart.
 */

import type { Settings } from "@savetabs/shared";
import { browser } from "wxt/browser";

/** Path of the full-tab sessions page inside the extension bundle. */
export const SESSIONS_PAGE_PATH = "/sessions.html";

/**
 * Absolute URL of the sessions page.
 *
 * WXT types `runtime.getURL` against generated public paths; the sessions
 * entrypoint is created in a later task, so widen the type here instead of
 * depending on generated types that do not exist yet.
 */
export function getSessionsPageUrl(): string {
  const runtime = browser.runtime as unknown as {
    getURL: (path: string) => string;
  };
  return runtime.getURL(SESSIONS_PAGE_PATH);
}

/**
 * Open the sessions page, reusing and focusing an existing tab when
 * `open.reuseSessionsTab` is enabled. Returns the id of the created or reused
 * tab when the browser reports one.
 */
export async function openOrReuseSessionsPage(
  settings: Settings,
): Promise<number | undefined> {
  const url = getSessionsPageUrl();

  if (settings["open.reuseSessionsTab"] === true) {
    const tabs = await browser.tabs.query({});
    const existing = tabs.find((tab) => tab.url === url);
    if (existing?.id !== undefined) {
      await browser.tabs.update(existing.id, { active: true });
      if (typeof existing.windowId === "number") {
        try {
          await browser.windows.update(existing.windowId, { focused: true });
        } catch {
          // The window may have closed between the lookup and the focus request.
        }
      }
      return existing.id;
    }
  }

  const created = await browser.tabs.create({ url });
  return created?.id;
}
