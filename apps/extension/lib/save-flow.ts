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

import { loadSettings } from "./settings";
import { addSession, listSessions } from "./sessions-repo";
import {
  collectTabEntries,
  type CollectedTab,
  type TabLike,
} from "./tab-collector";

/** Path of the full-tab sessions page. */
const SESSIONS_PAGE_PATH = "/sessions.html";

/**
 * Absolute URL of the sessions page.
 *
 * WXT types `runtime.getURL` against generated public paths; the sessions
 * entrypoint is created in a later task, so widen the type here instead of
 * depending on generated types that do not exist yet.
 */
function getSessionsPageUrl(): string {
  const runtime = browser.runtime as unknown as {
    getURL: (path: string) => string;
  };
  return runtime.getURL(SESSIONS_PAGE_PATH);
}

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

type TabScope = {
  tabs: TabLike[];
  /** True when the scope contained at least one incognito window or tab. */
  incognito: boolean;
};

function readBoolean(settings: Settings, key: string): boolean {
  return settings[key] === true;
}

function readNumber(settings: Settings, key: string): number {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

async function getWindow(
  windowId: number,
): Promise<{ id?: number; incognito?: boolean } | undefined> {
  try {
    return await browser.windows.get(windowId);
  } catch {
    return undefined;
  }
}

/** The focused window, falling back to the most recently focused one. */
async function getCurrentWindow(): Promise<
  { id?: number; incognito?: boolean } | undefined
> {
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
  filter: { active?: boolean; highlighted?: boolean },
): Promise<TabScope> {
  const window =
    windowId === undefined ? await getCurrentWindow() : await getWindow(windowId);
  const targetId = windowId ?? window?.id;

  const query: Parameters<typeof browser.tabs.query>[0] = { ...filter };
  if (targetId !== undefined) query.windowId = targetId;
  const tabs = await browser.tabs.query(query);

  return {
    tabs,
    incognito:
      window?.incognito === true ||
      tabs.some((tab) => tab.incognito === true),
  };
}

/** Every window allowed by `incognito.includeInSaveAll`. */
async function queryAllWindows(settings: Settings): Promise<TabScope> {
  const includeIncognito =
    readBoolean(settings, "incognito.includeInSaveAll") &&
    (await isIncognitoAllowed());
  const windows = await browser.windows.getAll({ populate: true });

  const tabs: TabLike[] = [];
  let incognito = false;

  for (const window of windows) {
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

async function queryTabsForSave(
  source: SessionSource,
  windowId: number | undefined,
  settings: Settings,
): Promise<TabScope> {
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

/** Opens the sessions page, reusing and focusing an existing tab if asked. */
async function openOrReuseSessionsPage(reuse: boolean): Promise<void> {
  const url = getSessionsPageUrl();

  if (reuse) {
    const tabs = await browser.tabs.query({});
    const existing = tabs.find((tab) => tab.url === url);
    if (existing?.id !== undefined) {
      await browser.tabs.update(existing.id, { active: true });
      return;
    }
  }

  await browser.tabs.create({ url });
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

  let scope: TabScope;
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
    scope = await queryTabsForSave(source, opts.windowId, settings);
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
    await openOrReuseSessionsPage(
      readBoolean(settings, "open.reuseSessionsTab"),
    );
  }

  return { session, skipped, closed, overflow };
}
