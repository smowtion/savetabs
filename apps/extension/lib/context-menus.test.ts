import { DEFAULT_SETTINGS, type Settings } from "@savetabs/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

const saveTabsMock = vi.hoisted(() =>
  vi.fn(async () => ({ skipped: 0, closed: 0, overflow: 0 })),
);

vi.mock("./save-flow", () => ({ saveTabs: saveTabsMock }));

import {
  CONTEXT_MENU_IDS,
  handleContextMenuClick,
  rebuildContextMenus,
} from "./context-menus";
import type { TabLike } from "./tab-collector";

function settingsWith(overrides: Settings = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function makeTab(id: number, url = `https://example.com/${id}`): TabLike {
  return { id, url, title: `Tab ${id}`, windowId: 7 };
}

beforeEach(() => {
  fakeBrowser.reset();
  // fake-browser leaves the context menu mutation APIs unimplemented; replace
  // them with spies so the wiring can be asserted.
  vi.spyOn(fakeBrowser.contextMenus, "removeAll").mockResolvedValue(undefined);
  vi.spyOn(fakeBrowser.contextMenus, "create").mockImplementation(
    () => "menu-id",
  );
  saveTabsMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rebuildContextMenus", () => {
  it("creates the three menu items from the default settings", async () => {
    const removeAllSpy = vi.spyOn(fakeBrowser.contextMenus, "removeAll");
    const createSpy = vi.spyOn(fakeBrowser.contextMenus, "create");

    await rebuildContextMenus(settingsWith());

    expect(removeAllSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls.map(([props]) => props)).toEqual([
      {
        id: CONTEXT_MENU_IDS.SAVE_TAB,
        title: "Save this tab",
        contexts: ["page", "tab"],
      },
      {
        id: CONTEXT_MENU_IDS.SAVE_WINDOW,
        title: "Save all tabs in this window",
        contexts: ["page", "tab"],
      },
      {
        id: CONTEXT_MENU_IDS.SAVE_SELECTION,
        title: "Save selected tabs",
        contexts: ["tab"],
      },
    ]);
    expect(removeAllSpy.mock.invocationCallOrder[0]).toBeLessThan(
      createSpy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("removes every menu item when the context menu is disabled", async () => {
    const removeAllSpy = vi.spyOn(fakeBrowser.contextMenus, "removeAll");
    const createSpy = vi.spyOn(fakeBrowser.contextMenus, "create");

    await rebuildContextMenus(
      settingsWith({ "contextMenu.enabled": false }),
    );

    expect(removeAllSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["contextMenu.saveTab", CONTEXT_MENU_IDS.SAVE_TAB],
    ["contextMenu.saveWindow", CONTEXT_MENU_IDS.SAVE_WINDOW],
    ["contextMenu.saveSelection", CONTEXT_MENU_IDS.SAVE_SELECTION],
  ] as const)("removes only the item disabled by %s", async (setting, absentId) => {
    const createSpy = vi.spyOn(fakeBrowser.contextMenus, "create");

    await rebuildContextMenus(settingsWith({ [setting]: false }));

    const ids = createSpy.mock.calls.map(([props]) => props.id);
    expect(ids).not.toContain(absentId);
    expect(ids).toHaveLength(2);
  });

  it("can rebuild repeatedly without leaving stale items", async () => {
    const createSpy = vi.spyOn(fakeBrowser.contextMenus, "create");

    await rebuildContextMenus(settingsWith());
    await rebuildContextMenus(
      settingsWith({ "contextMenu.saveSelection": false }),
    );

    expect(createSpy).toHaveBeenCalledTimes(5);
  });
});

describe("handleContextMenuClick", () => {
  it("saves the clicked tab for save-tab", async () => {
    const tab = makeTab(11);

    await handleContextMenuClick({
      menuItemId: CONTEXT_MENU_IDS.SAVE_TAB,
      windowId: 7,
      tab,
    });

    expect(saveTabsMock).toHaveBeenCalledWith("tab", {
      tabs: [tab],
      windowId: 7,
    });
  });

  it("uses the listener tab argument when the info has no tab", async () => {
    const tab = makeTab(12);

    await handleContextMenuClick(
      { menuItemId: CONTEXT_MENU_IDS.SAVE_TAB, windowId: 7 },
      tab,
    );

    expect(saveTabsMock).toHaveBeenCalledWith("tab", {
      tabs: [tab],
      windowId: 7,
    });
  });

  it("falls back to the active tab when save-tab has no tab context", async () => {
    await handleContextMenuClick({
      menuItemId: CONTEXT_MENU_IDS.SAVE_TAB,
    });

    expect(saveTabsMock).toHaveBeenCalledWith("tab");
  });

  it("saves the whole window for save-window", async () => {
    await handleContextMenuClick({
      menuItemId: CONTEXT_MENU_IDS.SAVE_WINDOW,
      windowId: 7,
    });

    expect(saveTabsMock).toHaveBeenCalledWith("window", { windowId: 7 });
  });

  it("lets the save flow resolve the window when save-window has no window id", async () => {
    await handleContextMenuClick({
      menuItemId: CONTEXT_MENU_IDS.SAVE_WINDOW,
    });

    expect(saveTabsMock).toHaveBeenCalledWith("window");
  });

  it("saves the highlighted tabs for save-selection", async () => {
    const tabs = [makeTab(21), makeTab(22)];
    const querySpy = vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue(
      tabs as unknown as never,
    );

    await handleContextMenuClick({
      menuItemId: CONTEXT_MENU_IDS.SAVE_SELECTION,
      windowId: 7,
    });

    expect(querySpy).toHaveBeenCalledWith({ highlighted: true, windowId: 7 });
    expect(saveTabsMock).toHaveBeenCalledWith("selection", {
      tabs,
      windowId: 7,
    });
  });

  it("does nothing for save-selection when no tabs are highlighted", async () => {
    vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue(
      [] as unknown as never,
    );

    await handleContextMenuClick({
      menuItemId: CONTEXT_MENU_IDS.SAVE_SELECTION,
      windowId: 7,
    });

    expect(saveTabsMock).not.toHaveBeenCalled();
  });

  it("ignores unknown menu items", async () => {
    await handleContextMenuClick({ menuItemId: "something-else" });

    expect(saveTabsMock).not.toHaveBeenCalled();
  });
});
