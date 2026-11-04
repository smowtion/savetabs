import { DEFAULT_SETTINGS, type Settings } from "@savetabs/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import {
  DISCARD_ACTIVITY_KEY,
  DISCARD_ALARM_NAME,
  DISCARD_STATS_KEY,
  applyDiscardAlarm,
  discardNow,
  evaluateAndDiscard,
  forgetTabActivity,
  getDiscardStats,
  isDiscardSupported,
  pruneActivity,
  recordActivity,
  recordWindowActivity,
} from "./discard";

/**
 * `wxt/testing` types `tabs.query` with the callback overload while its
 * implementation returns promises, so tests describe the promise surface.
 */
type BrowserTab = {
  id?: number;
  active?: boolean;
  pinned?: boolean;
  audible?: boolean;
  discarded?: boolean;
  url?: string;
  lastAccessed?: number;
};

type TabsApi = {
  query(queryInfo: { active?: boolean; windowId?: number }): Promise<BrowserTab[]>;
  discard(tabId: number): Promise<unknown>;
};

const tabsApi = fakeBrowser.tabs as unknown as TabsApi;

/** Local noon, so the stats date is the same in every timezone. */
const NOW = new Date(2026, 10, 4, 12, 0, 0).getTime();
const TODAY = "2026-11-04";
const MINUTE = 60_000;

function makeTab(overrides: Record<string, unknown> = {}): BrowserTab {
  return {
    id: 1,
    active: false,
    pinned: false,
    audible: false,
    discarded: false,
    url: "https://example.com/page",
    ...overrides,
  } as unknown as BrowserTab;
}

function settingsWith(overrides: Settings = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

async function seedSettings(overrides: Settings = {}): Promise<void> {
  await fakeBrowser.storage.local.set({ settings: settingsWith(overrides) });
}

function mockTabs(tabs: BrowserTab[]): void {
  vi.spyOn(tabsApi, "query").mockResolvedValue(tabs);
}

function mockDiscard() {
  return vi.spyOn(tabsApi, "discard").mockResolvedValue(undefined);
}

function removeTabsDiscard(): void {
  Object.defineProperty(fakeBrowser.tabs, "discard", {
    value: undefined,
    configurable: true,
  });
}

function removeSessionStorage(): void {
  Object.defineProperty(fakeBrowser.storage, "session", {
    value: undefined,
    configurable: true,
  });
}

let originalDiscard: typeof fakeBrowser.tabs.discard;
let originalSession: typeof fakeBrowser.storage.session;

beforeEach(() => {
  fakeBrowser.reset();
  originalDiscard = fakeBrowser.tabs.discard;
  originalSession = fakeBrowser.storage.session;
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(fakeBrowser.tabs, "discard", {
    value: originalDiscard,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(fakeBrowser.storage, "session", {
    value: originalSession,
    configurable: true,
    writable: true,
  });
});

describe("isDiscardSupported", () => {
  it("is true when tabs.discard is available", () => {
    expect(isDiscardSupported()).toBe(true);
  });

  it("is false when the browser lacks tabs.discard (Firefox)", () => {
    removeTabsDiscard();

    expect(isDiscardSupported()).toBe(false);
  });
});

describe("evaluateAndDiscard", () => {
  it("returns zero without side effects when discard is unsupported", async () => {
    removeTabsDiscard();
    await seedSettings();
    const querySpy = vi.spyOn(tabsApi, "query");
    const getSpy = vi.spyOn(fakeBrowser.storage.local, "get");

    await expect(evaluateAndDiscard(NOW)).resolves.toEqual({ discarded: 0 });

    expect(querySpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("discards only eligible tabs", async () => {
    await seedSettings({
      "memory.timeoutMinutes": 30,
      "memory.keepPinned": true,
      "memory.keepAudible": true,
      "tabs.excludedDomains": ["Mail.Google.com."],
    });
    const extensionUrl = fakeBrowser.runtime.getURL("options.html");
    mockTabs([
      makeTab({ id: 1, lastAccessed: NOW - 31 * MINUTE }),
      makeTab({ id: 2, active: true, lastAccessed: NOW - 60 * MINUTE }),
      makeTab({ id: 3, pinned: true, lastAccessed: NOW - 60 * MINUTE }),
      makeTab({ id: 4, audible: true, lastAccessed: NOW - 60 * MINUTE }),
      makeTab({
        id: 5,
        url: "https://mail.google.com/inbox",
        lastAccessed: NOW - 60 * MINUTE,
      }),
      makeTab({ id: 6, url: extensionUrl, lastAccessed: NOW - 60 * MINUTE }),
      makeTab({ id: 7, lastAccessed: NOW - 10 * MINUTE }),
      makeTab({ id: 8, discarded: true, lastAccessed: NOW - 60 * MINUTE }),
      makeTab({ id: undefined, lastAccessed: NOW - 60 * MINUTE }),
    ]);
    const discard = mockDiscard();

    await expect(evaluateAndDiscard(NOW)).resolves.toEqual({ discarded: 1 });

    expect(discard.mock.calls.map(([tabId]) => tabId)).toEqual([1]);
  });

  it("discards pinned and audible tabs when their settings are off", async () => {
    await seedSettings({
      "memory.timeoutMinutes": 30,
      "memory.keepPinned": false,
      "memory.keepAudible": false,
    });
    mockTabs([
      makeTab({ id: 1, pinned: true, lastAccessed: NOW - 60 * MINUTE }),
      makeTab({ id: 2, audible: true, lastAccessed: NOW - 60 * MINUTE }),
    ]);
    const discard = mockDiscard();

    await expect(evaluateAndDiscard(NOW)).resolves.toEqual({ discarded: 2 });

    expect(discard.mock.calls.map(([tabId]) => tabId)).toEqual([1, 2]);
  });

  it("does not sweep when auto-discard is off", async () => {
    await seedSettings({
      "memory.autoDiscard": false,
      "memory.timeoutMinutes": 30,
    });
    mockTabs([makeTab({ id: 1, lastAccessed: NOW - 60 * MINUTE })]);
    const discard = mockDiscard();

    await expect(evaluateAndDiscard(NOW)).resolves.toEqual({ discarded: 0 });

    expect(discard).not.toHaveBeenCalled();
  });

  it("uses tab.lastAccessed in preference to stored activity", async () => {
    await seedSettings({ "memory.timeoutMinutes": 30 });
    await fakeBrowser.storage.session.set({
      [DISCARD_ACTIVITY_KEY]: { "1": NOW - 60 * MINUTE },
    });
    mockTabs([makeTab({ id: 1, lastAccessed: NOW - MINUTE })]);
    const discard = mockDiscard();

    await expect(evaluateAndDiscard(NOW)).resolves.toEqual({ discarded: 0 });

    expect(discard).not.toHaveBeenCalled();
  });

  it("falls back to the stored activity when lastAccessed is missing", async () => {
    await seedSettings({ "memory.timeoutMinutes": 30 });
    await fakeBrowser.storage.session.set({
      [DISCARD_ACTIVITY_KEY]: { "1": NOW - 31 * MINUTE },
    });
    mockTabs([makeTab({ id: 1 })]);
    const discard = mockDiscard();

    await expect(evaluateAndDiscard(NOW)).resolves.toEqual({ discarded: 1 });

    expect(discard).toHaveBeenCalledWith(1);
  });

  it("keeps tabs whose activity is unknown", async () => {
    await seedSettings({ "memory.timeoutMinutes": 30 });
    mockTabs([makeTab({ id: 1 })]);
    const discard = mockDiscard();

    await expect(evaluateAndDiscard(NOW)).resolves.toEqual({ discarded: 0 });

    expect(discard).not.toHaveBeenCalled();
  });

  it("keeps counting when a single discard fails", async () => {
    await seedSettings({ "memory.timeoutMinutes": 30 });
    mockTabs([
      makeTab({ id: 1, lastAccessed: NOW - 60 * MINUTE }),
      makeTab({ id: 2, lastAccessed: NOW - 60 * MINUTE }),
    ]);
    vi.spyOn(tabsApi, "discard")
      .mockRejectedValueOnce(new Error("tab already closed"))
      .mockResolvedValueOnce(undefined);

    await expect(evaluateAndDiscard(NOW)).resolves.toEqual({ discarded: 1 });

    await expect(
      fakeBrowser.storage.local.get(DISCARD_STATS_KEY),
    ).resolves.toEqual({
      [DISCARD_STATS_KEY]: { date: TODAY, count: 1 },
    });
  });
});

describe("discardNow", () => {
  it("returns zero without side effects when discard is unsupported", async () => {
    removeTabsDiscard();
    await seedSettings();
    const querySpy = vi.spyOn(tabsApi, "query");

    await expect(discardNow()).resolves.toEqual({ discarded: 0 });

    expect(querySpy).not.toHaveBeenCalled();
  });

  it("ignores the inactivity threshold", async () => {
    await seedSettings({ "memory.timeoutMinutes": 120 });
    mockTabs([
      makeTab({ id: 1, lastAccessed: Date.now() - 1000 }),
      makeTab({ id: 2, lastAccessed: Date.now() - 1000 }),
    ]);
    const discard = mockDiscard();

    await expect(discardNow()).resolves.toEqual({ discarded: 2 });

    expect(discard.mock.calls.map(([tabId]) => tabId)).toEqual([1, 2]);
  });

  it("still works when auto-discard is off", async () => {
    await seedSettings({ "memory.autoDiscard": false });
    mockTabs([makeTab({ id: 1, lastAccessed: Date.now() - 1000 })]);
    const discard = mockDiscard();

    await expect(discardNow()).resolves.toEqual({ discarded: 1 });

    expect(discard).toHaveBeenCalledWith(1);
  });

  it("discards tabs whose timestamp is ahead of the clock", async () => {
    await seedSettings({ "memory.autoDiscard": false });
    mockTabs([makeTab({ id: 1, lastAccessed: Date.now() + 60 * MINUTE })]);
    const discard = mockDiscard();

    await expect(discardNow()).resolves.toEqual({ discarded: 1 });

    expect(discard).toHaveBeenCalledWith(1);
  });

  it("still honours active, pinned, audible and excluded guards", async () => {
    await seedSettings({
      "memory.keepPinned": true,
      "memory.keepAudible": true,
      "tabs.excludedDomains": ["excluded.example"],
    });
    const extensionUrl = fakeBrowser.runtime.getURL("popup.html");
    mockTabs([
      makeTab({ id: 1, lastAccessed: Date.now() - 1000 }),
      makeTab({ id: 2, active: true, lastAccessed: Date.now() - 1000 }),
      makeTab({ id: 3, pinned: true, lastAccessed: Date.now() - 1000 }),
      makeTab({ id: 4, audible: true, lastAccessed: Date.now() - 1000 }),
      makeTab({
        id: 5,
        url: "https://sub.excluded.example/page",
        lastAccessed: Date.now() - 1000,
      }),
      makeTab({ id: 6, url: extensionUrl, lastAccessed: Date.now() - 1000 }),
      makeTab({ id: 7, discarded: true, lastAccessed: Date.now() - 1000 }),
      makeTab({ id: undefined, lastAccessed: Date.now() - 1000 }),
    ]);
    const discard = mockDiscard();

    await expect(discardNow()).resolves.toEqual({ discarded: 1 });

    expect(discard.mock.calls.map(([tabId]) => tabId)).toEqual([1]);
  });
});

describe("discard stats", () => {
  it("records the number discarded for today", async () => {
    await seedSettings({ "memory.timeoutMinutes": 30 });
    mockTabs([
      makeTab({ id: 1, lastAccessed: NOW - 60 * MINUTE }),
      makeTab({ id: 2, lastAccessed: NOW - 60 * MINUTE }),
    ]);
    mockDiscard();

    await evaluateAndDiscard(NOW);

    await expect(getDiscardStats(NOW)).resolves.toEqual({
      date: TODAY,
      count: 2,
    });
  });

  it("increments the existing count on the same day", async () => {
    await seedSettings({ "memory.timeoutMinutes": 30 });
    await fakeBrowser.storage.local.set({
      [DISCARD_STATS_KEY]: { date: TODAY, count: 3 },
    });
    mockTabs([makeTab({ id: 1, lastAccessed: NOW - 60 * MINUTE })]);
    mockDiscard();

    await evaluateAndDiscard(NOW);

    await expect(getDiscardStats(NOW)).resolves.toEqual({
      date: TODAY,
      count: 4,
    });
  });

  it("rolls the count over on a new day", async () => {
    await seedSettings({ "memory.timeoutMinutes": 30 });
    await fakeBrowser.storage.local.set({
      [DISCARD_STATS_KEY]: { date: "2026-11-03", count: 7 },
    });
    mockTabs([makeTab({ id: 1, lastAccessed: NOW - 60 * MINUTE })]);
    mockDiscard();

    await evaluateAndDiscard(NOW);

    await expect(getDiscardStats(NOW)).resolves.toEqual({
      date: TODAY,
      count: 1,
    });
  });

  it("does not write stats when nothing was discarded", async () => {
    await seedSettings({ "memory.timeoutMinutes": 30 });
    await fakeBrowser.storage.local.set({
      [DISCARD_STATS_KEY]: { date: TODAY, count: 5 },
    });
    mockTabs([makeTab({ id: 1, lastAccessed: NOW - MINUTE })]);
    mockDiscard();

    await evaluateAndDiscard(NOW);

    await expect(getDiscardStats(NOW)).resolves.toEqual({
      date: TODAY,
      count: 5,
    });
  });

  it("reports zero for missing or stale stats", async () => {
    await expect(getDiscardStats(NOW)).resolves.toEqual({
      date: TODAY,
      count: 0,
    });

    await fakeBrowser.storage.local.set({
      [DISCARD_STATS_KEY]: { date: "2026-01-01", count: 9 },
    });

    await expect(getDiscardStats(NOW)).resolves.toEqual({
      date: TODAY,
      count: 0,
    });
  });
});

describe("activity tracking", () => {
  it("stores activity in storage.session when available", async () => {
    await recordActivity(7, NOW);

    await expect(
      fakeBrowser.storage.session.get(DISCARD_ACTIVITY_KEY),
    ).resolves.toEqual({ [DISCARD_ACTIVITY_KEY]: { "7": NOW } });
    await expect(
      fakeBrowser.storage.local.get(DISCARD_ACTIVITY_KEY),
    ).resolves.toEqual({});
  });

  it("falls back to storage.local when session storage is unavailable", async () => {
    removeSessionStorage();

    await recordActivity(9, NOW);

    await expect(
      fakeBrowser.storage.local.get(DISCARD_ACTIVITY_KEY),
    ).resolves.toEqual({ [DISCARD_ACTIVITY_KEY]: { "9": NOW } });
  });

  it("forgets a tab when it is removed", async () => {
    await recordActivity(1, NOW);
    await recordActivity(2, NOW);

    await forgetTabActivity(1);

    await expect(
      fakeBrowser.storage.session.get(DISCARD_ACTIVITY_KEY),
    ).resolves.toEqual({ [DISCARD_ACTIVITY_KEY]: { "2": NOW } });
  });

  it("prunes entries for tabs that are no longer open", async () => {
    await recordActivity(1, NOW);
    await recordActivity(2, NOW);
    await recordActivity(3, NOW);
    mockTabs([makeTab({ id: 1 }), makeTab({ id: 3 })]);

    await pruneActivity();

    await expect(
      fakeBrowser.storage.session.get(DISCARD_ACTIVITY_KEY),
    ).resolves.toEqual({ [DISCARD_ACTIVITY_KEY]: { "1": NOW, "3": NOW } });
  });

  it("records the active tab of the focused window", async () => {
    const window = await fakeBrowser.windows.create({ focused: true });
    if (window?.id === undefined) throw new Error("window has no id");
    const active = await fakeBrowser.tabs.create({
      url: "https://active.example",
      windowId: window.id,
      active: true,
    });
    if (active.id === undefined) throw new Error("tab has no id");

    await recordWindowActivity(window.id, NOW);

    const stored = await fakeBrowser.storage.session.get(DISCARD_ACTIVITY_KEY);
    expect(stored[DISCARD_ACTIVITY_KEY]).toMatchObject({
      [String(active.id)]: NOW,
    });
  });
});

describe("applyDiscardAlarm", () => {
  it("creates a one-minute sweep alarm when auto-discard is on", async () => {
    await applyDiscardAlarm(settingsWith({ "memory.autoDiscard": true }));

    const alarm = await fakeBrowser.alarms.get(DISCARD_ALARM_NAME);
    expect(alarm?.periodInMinutes).toBe(1);
  });

  it("does not reset an existing alarm", async () => {
    await fakeBrowser.alarms.create(DISCARD_ALARM_NAME, {
      periodInMinutes: 1,
    });
    const createSpy = vi.spyOn(fakeBrowser.alarms, "create");

    await applyDiscardAlarm(settingsWith({ "memory.autoDiscard": true }));

    expect(createSpy).not.toHaveBeenCalled();
  });

  it("clears the alarm when auto-discard is off", async () => {
    await fakeBrowser.alarms.create(DISCARD_ALARM_NAME, {
      periodInMinutes: 1,
    });

    await applyDiscardAlarm(settingsWith({ "memory.autoDiscard": false }));

    await expect(fakeBrowser.alarms.get(DISCARD_ALARM_NAME)).resolves.toBeUndefined();
  });

  it("clears the alarm when discard is unsupported", async () => {
    await fakeBrowser.alarms.create(DISCARD_ALARM_NAME, {
      periodInMinutes: 1,
    });
    removeTabsDiscard();

    await applyDiscardAlarm(settingsWith({ "memory.autoDiscard": true }));

    await expect(fakeBrowser.alarms.get(DISCARD_ALARM_NAME)).resolves.toBeUndefined();
  });
});
