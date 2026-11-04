/**
 * Shared save scope resolution.
 *
 * A `SAVE_TABS` request names a `SessionSource`, not a concrete tab list. The
 * scope rules decide which tabs that source covers:
 *
 * - `window` (and any source when `tabs.saveAllWindows` is off) is the
 *   current window; a provided `windowId` always narrows the scope to that
 *   window, even when all-windows saving is enabled.
 * - `all-windows`, or `window` without an id while `tabs.saveAllWindows` is
 *   on, covers every normal window. Popup and app windows never contribute.
 * - Incognito windows join an all-windows scope only when
 *   `incognito.includeInSaveAll` is on and the extension has incognito access.
 * - `tab` and `selection` query the active/highlighted tab of the target
 *   window.
 *
 * The same resolution powers the background save flow and the popup's
 * "Save N tabs" label, so the label can never drift from what a save stores
 * or closes. When a current-window scope cannot be resolved the helper fails
 * closed instead of widening to another window.
 */

import type { SessionSource, Settings } from "@savetabs/shared";
import { browser } from "wxt/browser";

import type { TabLike } from "./tab-collector";

/** Thrown when a save cannot determine which window it is scoped to. */
export class WindowUnavailableError extends Error {
  constructor() {
    super("Cannot resolve the target browser window for this save");
    this.name = "WindowUnavailableError";
  }
}

/** The tabs a save covers plus whether any incognito window contributed. */
export type SaveScope = {
  tabs: TabLike[];
  /** True when the scope contained at least one incognito window or tab. */
  incognito: boolean;
};

/** The window fields the scope resolver reads. */
export type ScopeWindow = {
  id?: number;
  incognito?: boolean;
};

type WindowFilter = { active?: boolean; highlighted?: boolean };

function readBoolean(settings: Settings, key: string): boolean {
  return settings[key] === true;
}

/**
 * Incognito access is a browser-managed permission. When the API is missing
 * or fails, rely on the fact that incognito windows are only visible to an
 * extension that already has access.
 */
async function isIncognitoAllowed(): Promise<boolean> {
  const extensionApi = browser.extension as typeof browser.extension & {
    isAllowedIncognitoAccess?: () => Promise<boolean>;
  };
  if (typeof extensionApi.isAllowedIncognitoAccess !== "function") return true;
  try {
    return await extensionApi.isAllowedIncognitoAccess();
  } catch {
    return true;
  }
}

/** One browser window, or undefined when it no longer exists. */
export async function getWindow(
  windowId: number,
): Promise<ScopeWindow | undefined> {
  try {
    return await browser.windows.get(windowId);
  } catch {
    return undefined;
  }
}

/** The focused window, falling back to the most recently focused one. */
export async function getCurrentWindow(): Promise<ScopeWindow | undefined> {
  try {
    const current = await browser.windows.getCurrent();
    if (current) return current;
  } catch {
    // Fall through to the last focused window.
  }
  try {
    return await browser.windows.getLastFocused();
  } catch {
    return undefined;
  }
}

async function queryTabsInWindow(
  windowId: number | undefined,
  filter: WindowFilter,
): Promise<SaveScope> {
  const window =
    windowId === undefined ? await getCurrentWindow() : await getWindow(windowId);
  const targetId = windowId ?? window?.id;
  if (targetId === undefined) throw new WindowUnavailableError();

  const tabs = await browser.tabs.query({ ...filter, windowId: targetId });

  return {
    tabs,
    incognito:
      window?.incognito === true ||
      tabs.some((tab) => tab.incognito === true),
  };
}

/** Every normal window allowed by `incognito.includeInSaveAll`. */
async function queryAllWindows(settings: Settings): Promise<SaveScope> {
  const includeIncognito =
    readBoolean(settings, "incognito.includeInSaveAll") &&
    (await isIncognitoAllowed());
  const windows = await browser.windows.getAll({ populate: true });

  const tabs: TabLike[] = [];
  let incognito = false;

  for (const window of windows) {
    // Save-all covers normal browser windows only; popup and app windows are
    // not part of the user's browsing session.
    if (window.type !== "normal") continue;
    if (window.incognito === true) {
      if (!includeIncognito) continue;
      incognito = true;
    }
    if (Array.isArray(window.tabs)) {
      tabs.push(...window.tabs);
    } else if (typeof window.id === "number") {
      tabs.push(...(await browser.tabs.query({ windowId: window.id })));
    }
  }

  return { tabs, incognito };
}

/**
 * Resolve the tabs a save covers, including whether the scope touched an
 * incognito window (the save flow marks such sessions local-only).
 *
 * This is the single implementation of the scope rules. UI code that only
 * needs the tab list uses `queryTabsForSaveScope`.
 */
export function querySaveScope(
  source: SessionSource,
  settings: Settings,
  windowId?: number,
): Promise<SaveScope> {
  const saveAllWindows = readBoolean(settings, "tabs.saveAllWindows");

  if (source === "all-windows") {
    return saveAllWindows
      ? queryAllWindows(settings)
      : queryTabsInWindow(windowId, {});
  }

  if (source === "window" && windowId === undefined && saveAllWindows) {
    return queryAllWindows(settings);
  }

  if (source === "tab") {
    return queryTabsInWindow(windowId, { active: true });
  }
  if (source === "selection") {
    return queryTabsInWindow(windowId, { highlighted: true });
  }

  return queryTabsInWindow(windowId, {});
}

/** The exact tabs a save would cover, for counts and previews. */
export async function queryTabsForSaveScope(
  source: SessionSource,
  settings: Settings,
  windowId?: number,
): Promise<TabLike[]> {
  const scope = await querySaveScope(source, settings, windowId);
  return scope.tabs;
}
