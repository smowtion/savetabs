import {
  DEFAULT_SETTINGS,
  type SavedTab,
  type Session,
  type Settings,
} from "@savetabs/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import {
  applyToolbarAction,
  formatBadgeCount,
  handleCommand,
  handleToolbarClick,
  updateBadge,
} from "./action";
import { SESSIONS_DB_NAME, closeSessionsDb } from "./sessions-db";
import { addSession, listSessions } from "./sessions-repo";
import { getSessionsPageUrl } from "./sessions-page";

function settingsWith(overrides: Settings = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function makeSession(id: string, tabCount: number): Session {
  const tabs: SavedTab[] = Array.from({ length: tabCount }, (_, index) => ({
    url: `https://example.com/${index}`,
    title: `Tab ${index}`,
  }));
  return {
    id,
    createdAt: 1,
    updatedAt: 1,
    source: "window",
    tabs,
  };
}

async function seedSettings(overrides: Settings = {}): Promise<void> {
  await fakeBrowser.storage.local.set({
    settings: settingsWith(overrides),
  });
}

async function seedWindowWithTab(url: string): Promise<void> {
  const window = await fakeBrowser.windows.create({
    type: "normal",
    focused: true,
  });
  if (window?.id === undefined) {
    throw new Error("fakeBrowser.windows.create returned no window id");
  }
  await fakeBrowser.tabs.create({ url, windowId: window.id, active: true });
}

/**
 * `wxt/testing` types `tabs.discard` with the callback overload while its
 * implementation returns promises, so the test describes the promise surface.
 */
type DiscardApi = { discard(tabId: number): Promise<unknown> };

const discardApi = fakeBrowser.tabs as unknown as DiscardApi;

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SESSIONS_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("deleteDatabase failed"));
    request.onblocked = () => reject(new Error("deleteDatabase blocked"));
  });
}

beforeEach(async () => {
  fakeBrowser.reset();
  // fake-browser leaves `action.setPopup` unimplemented; replace it with a spy.
  vi.spyOn(fakeBrowser.action, "setPopup").mockResolvedValue(undefined);
  await closeSessionsDb();
  await deleteDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeSessionsDb();
});

describe("applyToolbarAction", () => {
  it.each([
    ["popup", "popup.html"],
    ["save", ""],
    ["sessions", ""],
  ] as const)("toolbarAction=%s sets popup=%j", async (action, popup) => {
    const spy = vi.spyOn(fakeBrowser.action, "setPopup");

    await applyToolbarAction(settingsWith({ "open.toolbarAction": action }));

    expect(spy).toHaveBeenCalledWith({ popup });
  });

  it("falls back to the popup for unknown action values", async () => {
    const spy = vi.spyOn(fakeBrowser.action, "setPopup");

    await applyToolbarAction(settingsWith({ "open.toolbarAction": "bogus" }));

    expect(spy).toHaveBeenCalledWith({ popup: "popup.html" });
  });
});

describe("handleToolbarClick", () => {
  it("saves the current window when the action is save", async () => {
    await seedSettings({
      "open.toolbarAction": "save",
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    await seedWindowWithTab("https://example.com/active");

    await handleToolbarClick();

    const sessions = await listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.source).toBe("window");
    expect(sessions[0]?.tabs.map((tab) => tab.url)).toEqual([
      "https://example.com/active",
    ]);
  });

  it("opens the sessions page when the action is sessions", async () => {
    await seedSettings({
      "open.toolbarAction": "sessions",
      "open.reuseSessionsTab": false,
    });
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    await handleToolbarClick();

    expect(createSpy).toHaveBeenCalledWith({ url: getSessionsPageUrl() });
  });

  it("does nothing when the browser shows the popup", async () => {
    await seedSettings({ "open.toolbarAction": "popup" });
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    await handleToolbarClick();

    expect(createSpy).not.toHaveBeenCalled();
    await expect(listSessions()).resolves.toEqual([]);
  });
});

describe("handleCommand", () => {
  it("saves the current window for save-tabs", async () => {
    await seedSettings({
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    await seedWindowWithTab("https://example.com/command");

    await handleCommand("save-tabs");

    const sessions = await listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tabs.map((tab) => tab.url)).toEqual([
      "https://example.com/command",
    ]);
  });

  it("opens the sessions page for open-sessions", async () => {
    await seedSettings({ "open.reuseSessionsTab": false });
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    await handleCommand("open-sessions");

    expect(createSpy).toHaveBeenCalledWith({ url: getSessionsPageUrl() });
  });

  it("discards inactive tabs for discard-now", async () => {
    const window = await fakeBrowser.windows.create({
      type: "normal",
      focused: true,
    });
    if (window?.id === undefined) {
      throw new Error("fakeBrowser.windows.create returned no window id");
    }
    const tab = await fakeBrowser.tabs.create({
      url: "https://example.com/discard",
      windowId: window.id,
      active: false,
    });
    if (tab.id === undefined) throw new Error("fakeBrowser.tabs.create returned no id");
    const discardSpy = vi
      .spyOn(discardApi, "discard")
      .mockResolvedValue(undefined);

    await handleCommand("discard-now");

    expect(discardSpy).toHaveBeenCalledWith(tab.id);
  });

  it("ignores unknown commands", async () => {
    await seedSettings({ "open.openSessionsAfterSave": false });
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    await handleCommand("something-else");

    expect(createSpy).not.toHaveBeenCalled();
    await expect(listSessions()).resolves.toEqual([]);
  });
});

describe("formatBadgeCount", () => {
  it("hides the badge for zero tabs", () => {
    expect(formatBadgeCount(0)).toBe("");
  });

  it("shows the exact count up to three digits", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(42)).toBe("42");
    expect(formatBadgeCount(999)).toBe("999");
  });

  it("caps longer counts at 999+", () => {
    expect(formatBadgeCount(1000)).toBe("999+");
    expect(formatBadgeCount(12_345)).toBe("999+");
  });
});

describe("updateBadge", () => {
  it("clears the badge when showBadgeCount is disabled", async () => {
    await addSession(makeSession("session-1", 3));
    const spy = vi.spyOn(fakeBrowser.action, "setBadgeText");

    await updateBadge(settingsWith({ "general.showBadgeCount": false }));

    expect(spy).toHaveBeenCalledWith({ text: "" });
  });

  it("clears the badge when no tabs are stored", async () => {
    const spy = vi.spyOn(fakeBrowser.action, "setBadgeText");

    await updateBadge(settingsWith({ "general.showBadgeCount": true }));

    expect(spy).toHaveBeenCalledWith({ text: "" });
  });

  it("counts tabs across every stored session", async () => {
    await addSession(makeSession("session-1", 2));
    await addSession(makeSession("session-2", 3));
    const spy = vi.spyOn(fakeBrowser.action, "setBadgeText");

    await updateBadge(settingsWith({ "general.showBadgeCount": true }));

    expect(spy).toHaveBeenCalledWith({ text: "5" });
  });

  it("shows the exact count at the three digit limit", async () => {
    await addSession(makeSession("session-1", 999));
    const spy = vi.spyOn(fakeBrowser.action, "setBadgeText");

    await updateBadge(settingsWith({ "general.showBadgeCount": true }));

    expect(spy).toHaveBeenCalledWith({ text: "999" });
  });

  it("caps the badge at 999+", async () => {
    await addSession(makeSession("session-1", 1000));
    const spy = vi.spyOn(fakeBrowser.action, "setBadgeText");

    await updateBadge(settingsWith({ "general.showBadgeCount": true }));

    expect(spy).toHaveBeenCalledWith({ text: "999+" });
  });
});
