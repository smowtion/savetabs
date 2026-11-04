/**
 * Save flow: collect tabs, persist a session, close the saved tabs and open
 * the sessions page.
 *
 * The flow is intentionally unaware of sync. Callers that need to react to a
 * successful save (for example to enqueue an encrypted upload) pass `onSaved`,
 * which is awaited after persistence and before any tab is closed.
 */

import { type Session, type SessionSource, type Settings } from "@savetabs/shared";
import { browser } from "wxt/browser";

import {
  getCurrentWindow,
  getWindow,
  querySaveScope,
  type SaveScope,
} from "./save-scope";
import { loadSettings } from "./settings";
import {
  getSessionsPageUrl,
  openOrReuseSessionsPage,
} from "./sessions-page";
import { addSession, listSessions } from "./sessions-repo";
import {
  collectTabEntries,
  type CollectedTab,
  type TabLike,
} from "./tab-collector";

export { WindowUnavailableError } from "./save-scope";

/**
 * Asked before a save closes more tabs than `general.confirmThreshold`.
 * Receives the number of tabs that will be closed; resolve false to abort.
 */
export type ConfirmSave = (tabsToClose: number) => boolean | Promise<boolean>;

export type SaveTabsOptions = {
  /** Explicit tab list. When omitted the flow queries the browser. */
  tabs?: readonly TabLike[];
  /** Window to collect from for `window` saves. */
  windowId?: number;
  /** UI confirmation hook; omitted when the caller has no UI to show. */
  confirm?: ConfirmSave;
  /**
   * Awaited after the session is persisted and before tabs are closed.
   * Defaults to a no-op; sync wiring uses it to enqueue an upload.
   */
  onSaved?: (session: Session) => Promise<void>;
};

export type SaveTabsResult = {
  session?: Session;
  /** Every candidate tab that was not stored, overflow included. */
  skipped: number;
  /** Saved tabs that were closed; 0 when `tabs.closeAfterSave` is off. */
  closed: number;
  /** Tabs that were eligible but exceeded `LIMITS.maxTabsPerSession`. */
  overflow: number;
};

function readBoolean(settings: Settings, key: string): boolean {
  return settings[key] === true;
}

function readNumber(settings: Settings, key: string): number {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Closes the tabs that were saved, never the sessions page. Tabs without a
 * browser id (for example an imported selection) still count as closed.
 */
async function closeSavedTabs(
  entries: readonly CollectedTab[],
  shouldClose: boolean,
): Promise<number> {
  if (!shouldClose || entries.length === 0) return 0;

  const sessionsUrl = getSessionsPageUrl();
  const closable = entries.filter(
    (entry) => entry.saved.url !== sessionsUrl,
  );
  const tabIds = closable
    .map((entry) => entry.source.id)
    .filter((id): id is number => typeof id === "number");

  if (tabIds.length > 0) await browser.tabs.remove(tabIds);
  return closable.length;
}

/**
 * Save the tabs in scope as a new session.
 *
 * Order of operations: collect, confirm if the close count exceeds the
 * threshold, persist, await `onSaved`, close the saved tabs, open the sessions
 * page. Nothing is closed when persistence fails (`LocalQuotaError` is
 * rethrown to the caller).
 */
export async function saveTabs(
  source: SessionSource,
  opts: SaveTabsOptions = {},
): Promise<SaveTabsResult> {
  const settings = await loadSettings();
  const providedTabs = opts.tabs;

  let scope: SaveScope;
  if (providedTabs !== undefined) {
    const window =
      opts.windowId !== undefined
        ? await getWindow(opts.windowId)
        : await getCurrentWindow();
    scope = {
      tabs: [...providedTabs],
      incognito:
        window?.incognito === true ||
        providedTabs.some((tab) => tab.incognito === true),
    };
  } else {
    scope = await querySaveScope(source, settings, opts.windowId);
  }

  const existingSessions = await listSessions();
  const { entries, skipped, overflow } = collectTabEntries(scope.tabs, {
    settings,
    existingSessions,
  });

  if (entries.length === 0) {
    return { skipped, closed: 0, overflow: 0 };
  }

  const closeAfterSave = readBoolean(settings, "tabs.closeAfterSave");
  const tabsToClose = closeAfterSave ? entries.length : 0;
  const threshold = readNumber(settings, "general.confirmThreshold");

  if (
    opts.confirm !== undefined &&
    threshold > 0 &&
    tabsToClose > threshold
  ) {
    const approved = await opts.confirm(tabsToClose);
    if (!approved) {
      return { skipped, closed: 0, overflow };
    }
  }

  const now = Date.now();
  const session: Session = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    source,
    tabs: entries.map((entry) => entry.saved),
  };
  if (scope.incognito) session.incognito = true;

  await addSession(session);
  if (opts.onSaved !== undefined) await opts.onSaved(session);

  const closed = await closeSavedTabs(entries, closeAfterSave);
  if (readBoolean(settings, "open.openSessionsAfterSave")) {
    await openOrReuseSessionsPage(settings);
  }

  return { session, skipped, closed, overflow };
}
