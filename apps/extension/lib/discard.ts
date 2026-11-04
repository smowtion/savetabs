/**
 * Auto-discard service.
 *
 * Tracks when each tab was last active and discards tabs that have been idle
 * long enough to free memory. Discarding unloads a tab's renderer without
 * closing it; the tab stays in the tab strip and reloads on focus.
 *
 * The background service worker owns the lifecycle: `applyDiscardAlarm` keeps
 * the one-minute sweep alarm in sync with the settings, the activity helpers
 * are wired to tab/window events, and `evaluateAndDiscard` runs on each sweep.
 * `discardNow` backs the explicit "Discard now" action and skips the idle
 * threshold, but keeps every other guard.
 *
 * Firefox has supported `tabs.discard` since version 47, but the API is still
 * feature-detected: a browser without it reports
 * `isDiscardSupported() === false` and every entry point no-ops so the UI can
 * hide the feature instead of offering a dead control.
 */

import {
  isDiscardEligible,
  type DiscardCandidate,
  type DiscardOptions,
  type Settings,
} from "@savetabs/shared";
import { browser } from "wxt/browser";

import { loadSettings } from "./settings";
import { normalizeExcludedDomains } from "./tab-collector";

/** Alarm that evaluates inactive tabs once per minute. */
export const DISCARD_ALARM_NAME = "discard-sweep";
/** Sweep interval in minutes, matching the alarm period. */
export const DISCARD_ALARM_PERIOD_MINUTES = 1;
/** Storage key holding the per-tab `lastActiveAt` map. */
export const DISCARD_ACTIVITY_KEY = "discardActivity";
/** Storage key holding today's discard counter. */
export const DISCARD_STATS_KEY = "discardStats";

const DEFAULT_TIMEOUT_MINUTES = 30;

export type DiscardResult = { discarded: number };

/** Tabs discarded today, for the popup status line. */
export type DiscardStats = { date: string; count: number };

type ActivityMap = Record<string, number>;

/** The `get`/`set` surface shared by `storage.session` and `storage.local`. */
type KeyValueStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

/**
 * True when the browser implements `tabs.discard` (Firefox has supported it
 * since version 47). The rest of the module must treat every discard call as
 * unavailable when this returns false.
 */
export function isDiscardSupported(): boolean {
  const tabs = browser.tabs as unknown as { discard?: unknown };
  return typeof tabs.discard === "function";
}

function isStorageArea(value: unknown): value is KeyValueStorage {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<KeyValueStorage>;
  return (
    typeof candidate.get === "function" && typeof candidate.set === "function"
  );
}

/**
 * Prefer `storage.session`, which the browser clears on restart and which
 * keeps per-tab bookkeeping out of the persisted profile. Browsers without it
 * fall back to `storage.local`.
 */
function activityStorage(): KeyValueStorage {
  const storage = browser.storage as unknown as {
    session?: unknown;
    local: KeyValueStorage;
  };
  return isStorageArea(storage.session) ? storage.session : storage.local;
}

function parseActivity(raw: unknown): ActivityMap {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const map: ActivityMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) map[key] = value;
  }
  return map;
}

async function readActivity(): Promise<ActivityMap> {
  try {
    const stored = await activityStorage().get(DISCARD_ACTIVITY_KEY);
    return parseActivity(stored[DISCARD_ACTIVITY_KEY]);
  } catch {
    // Activity is best-effort: losing it only delays a discard.
    return {};
  }
}

async function writeActivity(map: ActivityMap): Promise<void> {
  try {
    await activityStorage().set({ [DISCARD_ACTIVITY_KEY]: map });
  } catch (error) {
    console.error("[savetabs] failed to persist discard activity", error);
  }
}

/**
 * Reads, mutates and rewrites the activity map one operation at a time.
 * Without this queue, two tab events in the same tick could read the same map
 * and the later write would drop the earlier tab's entry.
 */
let activityQueue: Promise<void> = Promise.resolve();

function updateActivity(mutate: (map: ActivityMap) => void): Promise<void> {
  const result = activityQueue.then(async () => {
    const map = await readActivity();
    mutate(map);
    await writeActivity(map);
  });
  activityQueue = result.catch(() => undefined);
  return result;
}

/** Remember that `tabId` became active at `now` (epoch ms). */
export async function recordActivity(
  tabId: number,
  now = Date.now(),
): Promise<void> {
  if (!isDiscardSupported()) return;
  if (!Number.isInteger(tabId) || tabId < 0) return;
  await updateActivity((map) => {
    map[String(tabId)] = now;
  });
}

/** Record the tab that is active in a window that just gained focus. */
export async function recordWindowActivity(
  windowId: number,
  now = Date.now(),
): Promise<void> {
  if (!isDiscardSupported()) return;
  try {
    const tabs = await browser.tabs.query({ active: true, windowId });
    const active = tabs[0];
    if (active?.id !== undefined) await recordActivity(active.id, now);
  } catch {
    // The window may have closed between the focus event and the query.
  }
}

/** Drop the activity entry for a tab that was closed. */
export async function forgetTabActivity(tabId: number): Promise<void> {
  await updateActivity((map) => {
    delete map[String(tabId)];
  });
}

/** Drop activity entries for tabs that are no longer open (startup cleanup). */
export async function pruneActivity(): Promise<void> {
  let openIds: Set<string>;
  try {
    const tabs = await browser.tabs.query({});
    openIds = new Set(
      tabs.flatMap((tab) => (tab.id === undefined ? [] : [String(tab.id)])),
    );
  } catch {
    return;
  }
  await updateActivity((map) => {
    for (const key of Object.keys(map)) {
      if (!openIds.has(key)) delete map[key];
    }
  });
}

function readTimeoutMinutes(settings: Settings): number {
  const value = settings["memory.timeoutMinutes"];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_TIMEOUT_MINUTES;
}

function readExcludedDomains(settings: Settings): string[] {
  const value = settings["tabs.excludedDomains"];
  if (!Array.isArray(value)) return [];
  return normalizeExcludedDomains(
    value.filter((entry): entry is string => typeof entry === "string"),
  );
}

/** `tab.lastAccessed` when the browser provides it. */
function readLastAccessed(tab: unknown): number | undefined {
  const value = (tab as { lastAccessed?: unknown }).lastAccessed;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The extension's own pages are never discarded. */
function isExtensionPage(url: string | undefined): boolean {
  if (url === undefined) return false;
  try {
    return url.startsWith(browser.runtime.getURL(""));
  } catch {
    return false;
  }
}

/**
 * Query every tab, apply the discard policy and unload the eligible ones.
 *
 * `timeoutMinutes` becomes `0` for an explicit discard, which keeps the
 * active/pinned/audible/excluded/extension guards while making the idle
 * threshold irrelevant. A tab without `lastAccessed` or recorded activity is
 * treated as active now, so it waits for a future sweep instead of being
 * discarded on first sight.
 */
async function runDiscard(
  now: number,
  enforceTimeout: boolean,
): Promise<DiscardResult> {
  if (!isDiscardSupported()) return { discarded: 0 };

  const settings = await loadSettings();
  // An alarm queued just before the user turned auto-discard off must not
  // still unload tabs.
  if (enforceTimeout && settings["memory.autoDiscard"] !== true) {
    return { discarded: 0 };
  }

  const tabs = await browser.tabs.query({});
  const activity = await readActivity();
  const options: DiscardOptions = {
    now,
    timeoutMinutes: enforceTimeout ? readTimeoutMinutes(settings) : 0,
    keepPinned: settings["memory.keepPinned"] === true,
    keepAudible: settings["memory.keepAudible"] === true,
    excludedDomains: readExcludedDomains(settings),
  };

  const targets: number[] = [];
  for (const tab of tabs) {
    const id = tab.id;
    if (id === undefined) continue;

    const url = typeof tab.url === "string" ? tab.url : undefined;
    if (isExtensionPage(url)) continue;

    const candidate: DiscardCandidate = {
      id,
      active: tab.active === true,
      pinned: tab.pinned === true,
      audible: tab.audible === true,
      discarded: tab.discarded === true,
      url,
      // Clock skew must not park a timestamp in the future, where it would
      // keep the tab alive indefinitely.
      lastActiveAt: Math.min(
        readLastAccessed(tab) ?? activity[String(id)] ?? now,
        now,
      ),
    };
    if (isDiscardEligible(candidate, options)) targets.push(id);
  }

  let discarded = 0;
  for (const tabId of targets) {
    try {
      await browser.tabs.discard(tabId);
      discarded += 1;
    } catch {
      // The tab may have closed or become non-discardable since the query.
    }
  }

  if (discarded > 0) await recordDiscardStats(discarded, now);
  return { discarded };
}

/** Sweep: discard every tab that has been idle for the configured timeout. */
export function evaluateAndDiscard(now = Date.now()): Promise<DiscardResult> {
  return runDiscard(now, true);
}

/** Discard every tab that passes the static guards, ignoring idle time. */
export function discardNow(): Promise<DiscardResult> {
  return runDiscard(Date.now(), false);
}

/** Local calendar day used for the daily counter (`YYYY-MM-DD`). */
function localDate(now: number): string {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseStats(raw: unknown): DiscardStats | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { date, count } = raw as { date?: unknown; count?: unknown };
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    return null;
  }
  return { date, count: Math.floor(count) };
}

/** Discards recorded for today; stale or malformed data reports zero. */
export async function getDiscardStats(now = Date.now()): Promise<DiscardStats> {
  const date = localDate(now);
  try {
    const stored = await browser.storage.local.get(DISCARD_STATS_KEY);
    const stats = parseStats(stored[DISCARD_STATS_KEY]);
    return stats !== null && stats.date === date ? stats : { date, count: 0 };
  } catch {
    return { date, count: 0 };
  }
}

/** Serialize counter updates so concurrent sweeps cannot lose increments. */
let statsQueue: Promise<void> = Promise.resolve();

function recordDiscardStats(discarded: number, now: number): Promise<void> {
  const result = statsQueue.then(async () => {
    const current = await getDiscardStats(now);
    try {
      await browser.storage.local.set({
        [DISCARD_STATS_KEY]: {
          date: current.date,
          count: current.count + discarded,
        },
      });
    } catch (error) {
      // The tabs were already discarded; a failed counter must not undo that.
      console.error("[savetabs] failed to persist discard stats", error);
    }
  });
  statsQueue = result.catch(() => undefined);
  return result;
}

/**
 * Create the sweep alarm when auto-discard is enabled and supported; clear it
 * otherwise. An existing alarm is left untouched so applying settings does not
 * postpone the next sweep.
 */
export async function applyDiscardAlarm(settings: Settings): Promise<void> {
  if (!isDiscardSupported() || settings["memory.autoDiscard"] !== true) {
    await browser.alarms.clear(DISCARD_ALARM_NAME);
    return;
  }

  const existing = await browser.alarms.get(DISCARD_ALARM_NAME);
  if (existing !== undefined) return;

  await browser.alarms.create(DISCARD_ALARM_NAME, {
    delayInMinutes: DISCARD_ALARM_PERIOD_MINUTES,
    periodInMinutes: DISCARD_ALARM_PERIOD_MINUTES,
  });
}
