/**
 * Restore flow: decide which saved tabs can be reopened and open them.
 *
 * `planRestore` is pure: it filters a session against the restore settings and
 * the URLs that are already open, without touching the browser. `executeRestore`
 * reads the stored settings, asks the browser for its open tabs when
 * `restore.skipExisting` is on, and creates the resulting tabs.
 *
 * Restoring only reads the session. The session is never deleted or rewritten,
 * so the user can restore it again or delete it explicitly.
 */

import {
  normalizeUrl,
  type MatchMode,
  type SavedTab,
  type Session,
  type Settings,
} from "@savetabs/shared";
import { browser } from "wxt/browser";

import { loadSettings } from "./settings";

/**
 * Schemes that can be opened as tabs. Sessions are already filtered when they
 * are saved, so anything else is dropped defensively at restore time.
 */
const RESTORABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  "http:",
  "https:",
  "file:",
]);

export type RestorePlan = { tabs: SavedTab[] };

export type RestoreResult = { opened: number };

function readBoolean(settings: Settings, key: string): boolean {
  return settings[key] === true;
}

function readMatchMode(settings: Settings): MatchMode {
  const value = settings["duplicates.matchMode"];
  return value === "ignore-hash" || value === "ignore-query" ? value : "exact";
}

/** True when the URL parses and uses a scheme the extension can restore. */
function isRestorableUrl(url: string): boolean {
  try {
    return RESTORABLE_PROTOCOLS.has(new URL(url).protocol.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Filter a session down to the tabs that can be reopened.
 *
 * Tabs keep their saved order. Malformed URLs and unsupported schemes are
 * dropped. `file:` is accepted because the save flow already applied
 * `tabs.includeFileUrls`. When `restore.skipExisting` is on, URLs that are
 * already open are removed; both sides are compared with
 * `duplicates.matchMode` normalization.
 */
export function planRestore(
  session: Session,
  settings: Settings,
  openUrls: readonly string[],
): RestorePlan {
  const skipExisting = readBoolean(settings, "restore.skipExisting");
  const matchMode = readMatchMode(settings);
  const open = skipExisting
    ? new Set(openUrls.map((url) => normalizeUrl(url, matchMode)))
    : null;

  const tabs: SavedTab[] = [];
  for (const tab of session.tabs) {
    if (!isRestorableUrl(tab.url)) continue;
    if (open !== null && open.has(normalizeUrl(tab.url, matchMode))) continue;
    tabs.push(tab);
  }

  return { tabs };
}

function createProperties(
  tab: SavedTab,
  active: boolean,
  restorePinned: boolean,
): { url: string; active: boolean; pinned?: true } {
  return {
    url: tab.url,
    active,
    ...(restorePinned && tab.pinned === true ? { pinned: true } : {}),
  };
}

/** Every open tab URL, in browser order. Tabs without a URL are ignored. */
async function listOpenTabUrls(): Promise<string[]> {
  const tabs = await browser.tabs.query({});
  return tabs.flatMap((tab) =>
    typeof tab.url === "string" ? [tab.url] : [],
  );
}

/**
 * `windows.create` cannot create its first tab pinned, so an originally pinned
 * first tab is pinned right after the window exists. The created window's tab
 * list is used when available; otherwise the window is queried.
 */
async function pinFirstTab(
  windowId: number,
  createdTabs: readonly { id?: number }[] | undefined,
): Promise<void> {
  let tabId = createdTabs?.[0]?.id;
  if (tabId === undefined) {
    const tabs = await browser.tabs.query({ windowId });
    const first = [...tabs].sort(
      (left, right) => (left.index ?? 0) - (right.index ?? 0),
    )[0];
    tabId = first?.id;
  }
  if (tabId !== undefined) await browser.tabs.update(tabId, { pinned: true });
}

/**
 * Open the restorable tabs of a session.
 *
 * `restore.targetWindow = "new"` creates a window from the first tab and adds
 * the remaining tabs to it; otherwise every tab is created in the current
 * window. `restore.openInBackground` becomes the tabs' `active` flag (the first
 * tab of a new window is active by construction). `pinned.restoreAsPinned`
 * recreates originally pinned tabs as pinned.
 *
 * Returns the number of tabs the restore opened; a session with nothing
 * restorable opens nothing and returns `{ opened: 0 }`.
 */
export async function executeRestore(session: Session): Promise<RestoreResult> {
  const settings = await loadSettings();
  const openUrls = readBoolean(settings, "restore.skipExisting")
    ? await listOpenTabUrls()
    : [];
  const { tabs } = planRestore(session, settings, openUrls);
  if (tabs.length === 0) return { opened: 0 };

  const active = !readBoolean(settings, "restore.openInBackground");
  const restorePinned = readBoolean(settings, "pinned.restoreAsPinned");

  if (settings["restore.targetWindow"] !== "new") {
    for (const tab of tabs) {
      await browser.tabs.create(createProperties(tab, active, restorePinned));
    }
    return { opened: tabs.length };
  }

  const [first, ...rest] = tabs;
  if (first === undefined) return { opened: 0 };

  const created = await browser.windows.create({ url: first.url });
  const windowId = created?.id;
  if (windowId === undefined) {
    throw new Error("Cannot restore tabs: the new window was not created");
  }

  if (restorePinned && first.pinned === true) {
    await pinFirstTab(windowId, created?.tabs);
  }
  for (const tab of rest) {
    await browser.tabs.create({
      ...createProperties(tab, active, restorePinned),
      windowId,
    });
  }

  return { opened: tabs.length };
}
