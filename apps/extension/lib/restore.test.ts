import {
  DEFAULT_SETTINGS,
  type SavedTab,
  type Session,
  type Settings,
} from "@savetabs/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { executeRestore, planRestore } from "./restore";

type FakeWindow = Awaited<ReturnType<typeof fakeBrowser.windows.create>>;

function makeTab(url: string, overrides: Partial<SavedTab> = {}): SavedTab {
  return { url, title: overrides.title ?? url, ...overrides };
}

function makeSession(
  tabs: readonly SavedTab[],
  overrides: Partial<Session> = {},
): Session {
  return {
    id: "session-1",
    createdAt: 1,
    updatedAt: 1,
    source: "window",
    tabs: [...tabs],
    ...overrides,
  };
}

function settingsWith(overrides: Settings = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

async function seedSettings(overrides: Settings = {}): Promise<void> {
  await fakeBrowser.storage.local.set({ settings: settingsWith(overrides) });
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("planRestore", () => {
  it("keeps http, https and file tabs in session order", () => {
    const session = makeSession([
      makeTab("https://one.example/path"),
      makeTab("http://two.example/"),
      makeTab("file:///Users/me/notes.txt"),
    ]);

    const plan = planRestore(session, settingsWith(), []);

    expect(plan.tabs.map((tab) => tab.url)).toEqual([
      "https://one.example/path",
      "http://two.example/",
      "file:///Users/me/notes.txt",
    ]);
  });

  it("drops malformed URLs and non-restorable schemes", () => {
    const session = makeSession([
      makeTab("chrome://settings"),
      makeTab("edge://favorites"),
      makeTab("about:blank"),
      makeTab("chrome-extension://abc/page.html"),
      makeTab("devtools://devtools/bundled/inspector.html"),
      makeTab("ftp://files.example/archive.zip"),
      makeTab("javascript:alert(1)"),
      makeTab("data:text/html,hello"),
      makeTab("not a url"),
      makeTab(""),
      makeTab("https://kept.example"),
    ]);

    const plan = planRestore(session, settingsWith(), []);

    expect(plan.tabs.map((tab) => tab.url)).toEqual([
      "https://kept.example",
    ]);
  });

  it("does not skip open URLs when restore.skipExisting is disabled", () => {
    const session = makeSession([makeTab("https://open.example")]);

    const plan = planRestore(session, settingsWith(), [
      "https://open.example",
    ]);

    expect(plan.tabs.map((tab) => tab.url)).toEqual(["https://open.example"]);
  });

  it("skips already-open URLs when restore.skipExisting is enabled", () => {
    const session = makeSession([
      makeTab("https://open.example"),
      makeTab("https://new.example"),
    ]);

    const plan = planRestore(
      session,
      settingsWith({ "restore.skipExisting": true }),
      ["https://open.example"],
    );

    expect(plan.tabs.map((tab) => tab.url)).toEqual(["https://new.example"]);
  });

  it("compares existing URLs with duplicates.matchMode", () => {
    const session = makeSession([
      makeTab("https://one.example/page#section"),
      makeTab("https://two.example/?a=1"),
      makeTab("https://three.example/"),
    ]);
    const openUrls = ["https://one.example/page", "https://two.example/?a=2"];

    const ignoreHash = planRestore(
      session,
      settingsWith({
        "restore.skipExisting": true,
        "duplicates.matchMode": "ignore-hash",
      }),
      openUrls,
    );
    const ignoreQuery = planRestore(
      session,
      settingsWith({
        "restore.skipExisting": true,
        "duplicates.matchMode": "ignore-query",
      }),
      openUrls,
    );

    expect(ignoreHash.tabs.map((tab) => tab.url)).toEqual([
      "https://two.example/?a=1",
      "https://three.example/",
    ]);
    // ignore-query only drops a query. The first saved URL has no query, so
    // its fragment is preserved and it does not match the open URL.
    expect(ignoreQuery.tabs.map((tab) => tab.url)).toEqual([
      "https://one.example/page#section",
      "https://three.example/",
    ]);
  });

  it("uses exact matching by default", () => {
    const session = makeSession([
      makeTab("https://one.example/page#section"),
    ]);

    const plan = planRestore(
      session,
      settingsWith({ "restore.skipExisting": true }),
      ["https://one.example/page"],
    );

    expect(plan.tabs.map((tab) => tab.url)).toEqual([
      "https://one.example/page#section",
    ]);
  });

  it("does not mutate the session", () => {
    const session = makeSession([
      makeTab("https://one.example"),
      makeTab("chrome://settings"),
    ]);
    const snapshot = JSON.parse(JSON.stringify(session)) as Session;

    planRestore(session, settingsWith({ "restore.skipExisting": true }), [
      "https://one.example",
    ]);

    expect(session).toEqual(snapshot);
  });
});

describe("executeRestore", () => {
  it("opens restorable tabs in the current window", async () => {
    await seedSettings();
    const createTab = vi.spyOn(fakeBrowser.tabs, "create");
    const createWindow = vi.spyOn(fakeBrowser.windows, "create");
    const session = makeSession([
      makeTab("https://one.example"),
      makeTab("https://two.example"),
    ]);

    const result = await executeRestore(session);

    expect(result).toEqual({ opened: 2 });
    expect(createWindow).not.toHaveBeenCalled();
    expect(createTab).toHaveBeenNthCalledWith(1, {
      url: "https://one.example",
      active: false,
    });
    expect(createTab).toHaveBeenNthCalledWith(2, {
      url: "https://two.example",
      active: false,
    });
  });

  it("activates opened tabs when openInBackground is disabled", async () => {
    await seedSettings({ "restore.openInBackground": false });
    const createTab = vi.spyOn(fakeBrowser.tabs, "create");
    const session = makeSession([makeTab("https://one.example")]);

    await executeRestore(session);

    expect(createTab).toHaveBeenCalledWith({
      url: "https://one.example",
      active: true,
    });
  });

  it("restores file URLs", async () => {
    await seedSettings();
    const createTab = vi.spyOn(fakeBrowser.tabs, "create");
    const session = makeSession([makeTab("file:///Users/me/notes.txt")]);

    const result = await executeRestore(session);

    expect(result).toEqual({ opened: 1 });
    expect(createTab).toHaveBeenCalledWith({
      url: "file:///Users/me/notes.txt",
      active: false,
    });
  });

  it("creates a new window with the first tab and the rest inside it", async () => {
    await seedSettings({ "restore.targetWindow": "new" });
    const createWindow = vi
      .spyOn(fakeBrowser.windows, "create")
      .mockResolvedValue({ id: 77 } as unknown as FakeWindow);
    const createTab = vi.spyOn(fakeBrowser.tabs, "create");
    const session = makeSession([
      makeTab("https://one.example"),
      makeTab("https://two.example"),
      makeTab("https://three.example"),
    ]);

    const result = await executeRestore(session);

    expect(result).toEqual({ opened: 3 });
    expect(createWindow).toHaveBeenCalledWith({
      url: "https://one.example",
      focused: false,
    });
    expect(createTab).toHaveBeenNthCalledWith(1, {
      windowId: 77,
      url: "https://two.example",
      active: false,
    });
    expect(createTab).toHaveBeenNthCalledWith(2, {
      windowId: 77,
      url: "https://three.example",
      active: false,
    });
  });

  it("focuses the new window when openInBackground is disabled", async () => {
    await seedSettings({
      "restore.targetWindow": "new",
      "restore.openInBackground": false,
    });
    const createWindow = vi
      .spyOn(fakeBrowser.windows, "create")
      .mockResolvedValue({ id: 77 } as unknown as FakeWindow);
    const createTab = vi.spyOn(fakeBrowser.tabs, "create");
    const session = makeSession([
      makeTab("https://one.example"),
      makeTab("https://two.example"),
    ]);

    await executeRestore(session);

    expect(createWindow).toHaveBeenCalledWith({
      url: "https://one.example",
      focused: true,
    });
    expect(createTab).toHaveBeenNthCalledWith(1, {
      windowId: 77,
      url: "https://two.example",
      active: true,
    });
  });

  it("restores originally pinned tabs as pinned", async () => {
    await seedSettings();
    const createTab = vi.spyOn(fakeBrowser.tabs, "create");
    const session = makeSession([
      makeTab("https://pinned.example", { pinned: true }),
      makeTab("https://plain.example"),
    ]);

    await executeRestore(session);

    expect(createTab).toHaveBeenNthCalledWith(1, {
      url: "https://pinned.example",
      active: false,
      pinned: true,
    });
    expect(createTab).toHaveBeenNthCalledWith(2, {
      url: "https://plain.example",
      active: false,
    });
  });

  it("does not pin tabs when pinned.restoreAsPinned is disabled", async () => {
    await seedSettings({ "pinned.restoreAsPinned": false });
    const createTab = vi.spyOn(fakeBrowser.tabs, "create");
    const session = makeSession([
      makeTab("https://pinned.example", { pinned: true }),
    ]);

    await executeRestore(session);

    expect(createTab).toHaveBeenCalledWith({
      url: "https://pinned.example",
      active: false,
    });
  });

  it("pins the first tab of a new window when it was pinned", async () => {
    await seedSettings({ "restore.targetWindow": "new" });
    vi.spyOn(fakeBrowser.windows, "create").mockResolvedValue({
      id: 77,
      tabs: [{ id: 55 }],
    } as unknown as FakeWindow);
    const updateTab = vi
      .spyOn(fakeBrowser.tabs, "update")
      .mockResolvedValue({} as never);
    const session = makeSession([
      makeTab("https://pinned.example", { pinned: true }),
      makeTab("https://plain.example"),
    ]);

    await executeRestore(session);

    expect(updateTab).toHaveBeenCalledWith(55, { pinned: true });
  });

  it("skips URLs that are already open", async () => {
    await seedSettings({ "restore.skipExisting": true });
    await fakeBrowser.tabs.create({ url: "https://open.example" });
    const createTab = vi.spyOn(fakeBrowser.tabs, "create");
    const session = makeSession([
      makeTab("https://open.example"),
      makeTab("https://new.example"),
    ]);

    const result = await executeRestore(session);

    expect(result).toEqual({ opened: 1 });
    expect(createTab).toHaveBeenCalledTimes(1);
    expect(createTab).toHaveBeenCalledWith({
      url: "https://new.example",
      active: false,
    });
  });

  it("does nothing when the session has no restorable tabs", async () => {
    await seedSettings();
    const createTab = vi.spyOn(fakeBrowser.tabs, "create");
    const createWindow = vi.spyOn(fakeBrowser.windows, "create");
    const session = makeSession([
      makeTab("chrome://settings"),
      makeTab("about:blank"),
      makeTab("not a url"),
    ]);

    await expect(executeRestore(session)).resolves.toEqual({ opened: 0 });

    expect(createTab).not.toHaveBeenCalled();
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("leaves the session unchanged after restoring", async () => {
    await seedSettings();
    vi.spyOn(fakeBrowser.tabs, "create");
    const session = makeSession([
      makeTab("https://one.example", { pinned: true }),
    ]);
    const snapshot = JSON.parse(JSON.stringify(session)) as Session;

    await executeRestore(session);

    expect(session).toEqual(snapshot);
  });
});
