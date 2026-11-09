import {
  DEFAULT_SETTINGS,
  type Session,
  type Settings,
} from "@savetabs/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

/** The session a real save flow would hand to its `onSaved` hook. */
const freshSessionRef = vi.hoisted(() => ({
  current: {
    id: "fresh-session",
    createdAt: 1,
    updatedAt: 1,
    source: "window" as const,
    tabs: [],
  } as Session,
}));

const saveTabsMock = vi.hoisted(() =>
  vi.fn(
    async (
      _source: unknown,
      options?: { onSaved?: (session: Session) => Promise<void> },
    ) => {
      await options?.onSaved?.(freshSessionRef.current);
      return { skipped: 0, closed: 0, overflow: 0 };
    },
  ),
);

vi.mock("./save-flow", () => ({ saveTabs: saveTabsMock }));
vi.mock("./sync/sync-service", () => ({
  enqueueUpload: vi.fn(),
  syncNow: vi.fn(),
}));

import {
  CONTEXT_MENU_IDS,
  handleContextMenuClick,
  rebuildContextMenus,
} from "./context-menus";
import { syncSavedSession } from "./sync/sync-lifecycle";
import { enqueueUpload } from "./sync/sync-service";
import type { TabLike } from "./tab-collector";

const enqueueUploadMock = vi.mocked(enqueueUpload);

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
  enqueueUploadMock.mockClear();
  enqueueUploadMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rebuildContextMenus", () => {
  it("creates the three menu items from the default settings", async () => {
    const removeAllSpy = vi.spyOn(fakeBrowser.contextMenus, "removeAll");
    const createSpy = vi.spyOn(fakeBrowser.contextMenus, "create");

    await rebuildContextMenus(settingsWith({ "general.language": "en" }));

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
      {
        id: CONTEXT_MENU_IDS.SETTINGS,
        title: "Settings",
        contexts: ["action"],
      },
    ]);
    expect(removeAllSpy.mock.invocationCallOrder[0]).toBeLessThan(
      createSpy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it.each([
    [
      "vi",
      [
        "Lưu tab này",
        "Lưu tất cả tab trong cửa sổ",
        "Lưu các tab đã chọn",
        "Cài đặt",
      ],
    ],
    [
      "zh-CN",
      ["保存此标签页", "保存此窗口中的所有标签页", "保存选中的标签页", "设置"],
    ],
    [
      "es",
      [
        "Guardar esta pestaña",
        "Guardar todas las pestañas de esta ventana",
        "Guardar las pestañas seleccionadas",
        "Ajustes",
      ],
    ],
  ] as const)(
    "localizes menu titles to %s",
    async (language, expectedTitles) => {
      const createSpy = vi.spyOn(fakeBrowser.contextMenus, "create");

      await rebuildContextMenus(settingsWith({ "general.language": language }));

      expect(createSpy.mock.calls.map(([props]) => props.title)).toEqual([
        ...expectedTitles,
      ]);
    },
  );

  it("keeps only the toolbar settings item when the context menu is disabled", async () => {
    const removeAllSpy = vi.spyOn(fakeBrowser.contextMenus, "removeAll");
    const createSpy = vi.spyOn(fakeBrowser.contextMenus, "create");

    await rebuildContextMenus(
      settingsWith({ "contextMenu.enabled": false }),
    );

    expect(removeAllSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]?.[0]).toEqual({
      id: CONTEXT_MENU_IDS.SETTINGS,
      title: "Settings",
      contexts: ["action"],
    });
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
    expect(ids).toHaveLength(3);
  });

  it("can rebuild repeatedly without leaving stale items", async () => {
    const createSpy = vi.spyOn(fakeBrowser.contextMenus, "create");

    await rebuildContextMenus(settingsWith());
    await rebuildContextMenus(
      settingsWith({ "contextMenu.saveSelection": false }),
    );

    expect(createSpy).toHaveBeenCalledTimes(7);
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
      onSaved: syncSavedSession,
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
      onSaved: syncSavedSession,
    });
  });

  it("falls back to the active tab when save-tab has no tab context", async () => {
    await handleContextMenuClick({
      menuItemId: CONTEXT_MENU_IDS.SAVE_TAB,
    });

    expect(saveTabsMock).toHaveBeenCalledWith("tab", {
      onSaved: syncSavedSession,
    });
  });

  it("saves the whole window for save-window", async () => {
    await handleContextMenuClick({
      menuItemId: CONTEXT_MENU_IDS.SAVE_WINDOW,
      windowId: 7,
    });

    expect(saveTabsMock).toHaveBeenCalledWith("window", {
      windowId: 7,
      onSaved: syncSavedSession,
    });
  });

  it("lets the save flow resolve the window when save-window has no window id", async () => {
    await handleContextMenuClick({
      menuItemId: CONTEXT_MENU_IDS.SAVE_WINDOW,
    });

    expect(saveTabsMock).toHaveBeenCalledWith("window", {
      onSaved: syncSavedSession,
    });
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
      onSaved: syncSavedSession,
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

  it("opens the options page for the settings item", async () => {
    const openOptionsPage = vi
      .spyOn(fakeBrowser.runtime, "openOptionsPage")
      .mockResolvedValue(undefined);

    await handleContextMenuClick({ menuItemId: CONTEXT_MENU_IDS.SETTINGS });

    expect(openOptionsPage).toHaveBeenCalledTimes(1);
    expect(saveTabsMock).not.toHaveBeenCalled();
  });

  it("ignores unknown menu items", async () => {
    await handleContextMenuClick({ menuItemId: "something-else" });

    expect(saveTabsMock).not.toHaveBeenCalled();
  });

  it.each([
    ["save-tab", CONTEXT_MENU_IDS.SAVE_TAB],
    ["save-window", CONTEXT_MENU_IDS.SAVE_WINDOW],
    ["save-selection", CONTEXT_MENU_IDS.SAVE_SELECTION],
  ] as const)(
    "uploads the fresh session for %s when auto-upload is on",
    async (_label, menuItemId) => {
      await fakeBrowser.storage.local.set({
        settings: settingsWith({
          "sync.enabled": true,
          "sync.autoUpload": true,
        }),
      });
      const tabs = [makeTab(31)];
      vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue(
        tabs as unknown as never,
      );

      await handleContextMenuClick({
        menuItemId,
        windowId: 7,
        tab: tabs[0],
      });

      expect(enqueueUploadMock).toHaveBeenCalledTimes(1);
      expect(enqueueUploadMock).toHaveBeenCalledWith({
        ...freshSessionRef.current,
        pendingUpload: true,
      });
    },
  );

  it.each([
    ["save-tab", CONTEXT_MENU_IDS.SAVE_TAB],
    ["save-window", CONTEXT_MENU_IDS.SAVE_WINDOW],
    ["save-selection", CONTEXT_MENU_IDS.SAVE_SELECTION],
  ] as const)(
    "does not upload the fresh session for %s when auto-upload is off",
    async (_label, menuItemId) => {
      await fakeBrowser.storage.local.set({
        settings: settingsWith({
          "sync.enabled": true,
          "sync.autoUpload": false,
        }),
      });
      const tabs = [makeTab(32)];
      vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue(
        tabs as unknown as never,
      );

      await handleContextMenuClick({
        menuItemId,
        windowId: 7,
        tab: tabs[0],
      });

      expect(saveTabsMock).toHaveBeenCalledTimes(1);
      expect(enqueueUploadMock).not.toHaveBeenCalled();
    },
  );
});
