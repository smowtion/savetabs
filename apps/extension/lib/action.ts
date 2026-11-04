/**
 * Toolbar action, keyboard command and badge behavior for the background
 * service worker.
 *
 * `open.toolbarAction` decides whether clicking the toolbar icon opens the
 * popup, saves the window immediately, or opens the sessions page. When it is
 * not `"popup"`, the popup is cleared so the browser fires `action.onClicked`
 * instead of opening a popup.
 */

import type { Settings } from "@savetabs/shared";
import { browser } from "wxt/browser";

import { discardNow } from "./discard";
import { saveTabs } from "./save-flow";
import { getUsage } from "./sessions-repo";
import { openOrReuseSessionsPage } from "./sessions-page";
import { loadSettings } from "./settings";

/** Popup entrypoint path passed to `action.setPopup` (WXT build output). */
export const ACTION_POPUP_PATH = "popup.html";

/** Largest three-digit count a badge can show. */
export const BADGE_COUNT_MAX = 999;

export type ToolbarAction = "popup" | "save" | "sessions";

/** The configured toolbar action; unknown stored values fall back to a popup. */
export function resolveToolbarAction(settings: Settings): ToolbarAction {
  const value = settings["open.toolbarAction"];
  return value === "save" || value === "sessions" ? value : "popup";
}

/**
 * Program the toolbar icon for the configured action.
 *
 * Chrome only fires `action.onClicked` when no popup is set, so the save and
 * sessions actions clear the popup instead of disabling the click.
 */
export async function applyToolbarAction(settings: Settings): Promise<void> {
  const action = resolveToolbarAction(settings);
  await browser.action.setPopup({
    popup: action === "popup" ? ACTION_POPUP_PATH : "",
  });
}

/**
 * Handle a raw toolbar click (only fired when the popup is cleared).
 *
 * The click is an explicit user intent, so saves execute without a
 * confirmation prompt; `saveTabs` still applies every other save rule.
 */
export async function handleToolbarClick(): Promise<void> {
  const settings = await loadSettings();
  const action = resolveToolbarAction(settings);

  if (action === "save") {
    await saveTabs("window");
    return;
  }
  if (action === "sessions") {
    await openOrReuseSessionsPage(settings);
  }
  // "popup" never reaches this listener: the browser opens the popup itself.
}

/**
 * Route a keyboard command.
 *
 * `discard-now` delegates to the auto-discard service; unknown commands are
 * ignored instead of being faked.
 */
export async function handleCommand(command: string): Promise<void> {
  if (command === "save-tabs") {
    await saveTabs("window");
    return;
  }
  if (command === "open-sessions") {
    await openOrReuseSessionsPage(await loadSettings());
    return;
  }
  if (command === "discard-now") {
    await discardNow();
  }
}

/**
 * Chrome badges truncate after four characters, so counts above 999 render as
 * `999+`. Zero hides the badge entirely.
 */
export function formatBadgeCount(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "";
  return total > BADGE_COUNT_MAX ? `${BADGE_COUNT_MAX}+` : String(total);
}

/**
 * Show the total number of saved tabs across every local session, or clear the
 * badge when `general.showBadgeCount` is off.
 */
export async function updateBadge(settings: Settings): Promise<void> {
  if (settings["general.showBadgeCount"] !== true) {
    await browser.action.setBadgeText({ text: "" });
    return;
  }

  const usage = await getUsage();
  await browser.action.setBadgeText({ text: formatBadgeCount(usage.tabs) });
}
