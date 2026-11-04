import {
  DEFAULT_SETTINGS,
  LIMITS,
  type SavedTab,
  type Session,
  type Settings,
} from "@savetabs/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import {
  SESSIONS_DB_NAME,
  SESSIONS_STORE_NAME,
  closeSessionsDb,
  openSessionsDb,
} from "./sessions-db";
import { LocalQuotaError, getSession, listSessions } from "./sessions-repo";
import { WindowUnavailableError, saveTabs } from "./save-flow";
import type { TabLike } from "./tab-collector";

const SESSIONS_PAGE_URL = "/sessions.html";

function makeTabs(count: number, withIds = false): TabLike[] {
  return Array.from({ length: count }, (_, index) => ({
    ...(withIds ? { id: index + 1 } : {}),
    url: `https://example.com/${index}`,
    title: `Tab ${index}`,
  }));
}

let sessionCounter = 0;

function makeSession(
  id: string,
  tabs: readonly SavedTab[],
  overrides: Partial<Session> = {},
): Session {
  sessionCounter += 1;
  return {
    id,
    createdAt: sessionCounter,
    updatedAt: sessionCounter,
    source: "window",
    tabs: [...tabs],
    ...overrides,
  };
}

function settingsWith(overrides: Settings = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** Creates a fake browser window and narrows its id for use in tests. */
async function createWindow(
  incognito = false,
  focused = false,
): Promise<{ id: number }> {
  const created = await fakeBrowser.windows.create({
    incognito,
    focused,
    type: "normal",
  });
  if (created?.id === undefined) {
    throw new Error("fakeBrowser.windows.create returned no window id");
  }
  return { id: created.id };
}

async function seedSettings(overrides: Settings = {}): Promise<void> {
  await fakeBrowser.storage.local.set({
    settings: settingsWith(overrides),
  });
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SESSIONS_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("deleteDatabase failed"));
    request.onblocked = () => reject(new Error("deleteDatabase blocked"));
  });
}

/** Seeds sessions directly through the database layer, bypassing `addSession`. */
async function seedSessions(sessions: readonly Session[]): Promise<void> {
  const database = await openSessionsDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SESSIONS_STORE_NAME, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("seed failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("seed aborted"));
    const store = transaction.objectStore(SESSIONS_STORE_NAME);
    for (const session of sessions) store.put(session);
  });
}

beforeEach(async () => {
  fakeBrowser.reset();
  await closeSessionsDb();
  await deleteDatabase();
  sessionCounter = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeSessionsDb();
});

describe("saveTabs", () => {
  it("caps at 500 tabs and leaves the rest open", async () => {
    await seedSettings({ "open.openSessionsAfterSave": false });
    const tabs = makeTabs(LIMITS.maxTabsPerSession + 1);

    const res = await saveTabs("window", { tabs });

    expect(res.session?.tabs).toHaveLength(LIMITS.maxTabsPerSession);
    expect(res.overflow).toBe(1);
    expect(res.closed).toBe(LIMITS.maxTabsPerSession);
    expect(res.skipped).toBe(1);
    await expect(listSessions()).resolves.toHaveLength(1);
  });

  it("returns no session when nothing can be saved", async () => {
    await seedSettings();
    const removeSpy = vi.spyOn(fakeBrowser.tabs, "remove");
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    const res = await saveTabs("window", {
      tabs: [{ url: "chrome://newtab" }, { url: "about:blank" }],
    });

    expect(res.session).toBeUndefined();
    expect(res).toMatchObject({ skipped: 2, closed: 0, overflow: 0 });
    await expect(listSessions()).resolves.toEqual([]);
    expect(removeSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("persists a new session with a generated id, timestamps and source", async () => {
    await seedSettings({
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    vi.spyOn(Date, "now").mockReturnValue(1_234_567);

    const res = await saveTabs("tab", {
      tabs: [{ url: "https://example.com", title: "Example" }],
    });
    const session = res.session;

    expect(session).toBeDefined();
    expect(session?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(session).toMatchObject({
      createdAt: 1_234_567,
      updatedAt: 1_234_567,
      source: "tab",
      tabs: [{ url: "https://example.com", title: "Example" }],
    });
    await expect(getSession(session?.id ?? "")).resolves.toEqual(session);
    expect(res).toMatchObject({ skipped: 0, closed: 0, overflow: 0 });
  });

  it("marks the session incognito when the save batch contains an incognito tab", async () => {
    await seedSettings({
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });

    const res = await saveTabs("selection", {
      tabs: [
        { url: "https://public.example" },
        { url: "https://private.example", incognito: true },
      ],
    });

    expect(res.session?.incognito).toBe(true);
  });

  it("marks sessions saved from an incognito window", async () => {
    await seedSettings({
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    const window = await createWindow(true, true);
    await fakeBrowser.tabs.create({
      url: "https://private.example",
      windowId: window.id,
    });

    const res = await saveTabs("window", { windowId: window.id });

    expect(res.session?.incognito).toBe(true);
    expect(res.session?.tabs.map((tab) => tab.url)).toEqual([
      "https://private.example",
    ]);
  });

  it("leaves the incognito flag unset for ordinary sessions", async () => {
    await seedSettings({
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });

    const res = await saveTabs("window", { tabs: makeTabs(2) });

    expect(res.session?.incognito).toBeUndefined();
  });

  it("keeps tabs open when tabs.closeAfterSave is disabled", async () => {
    await seedSettings({
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    const removeSpy = vi.spyOn(fakeBrowser.tabs, "remove");

    const res = await saveTabs("window", { tabs: makeTabs(3) });

    expect(res.closed).toBe(0);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("closes only the saved tabs after persisting", async () => {
    await seedSettings({ "open.openSessionsAfterSave": false });
    const tabs = makeTabs(3, true);
    const removeSpy = vi.spyOn(fakeBrowser.tabs, "remove");

    const res = await saveTabs("window", { tabs });

    expect(res.closed).toBe(3);
    expect(removeSpy).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("closes only tabs that fit under the cap", async () => {
    await seedSettings({ "open.openSessionsAfterSave": false });
    const tabs = makeTabs(LIMITS.maxTabsPerSession + 1, true);
    const removeSpy = vi.spyOn(fakeBrowser.tabs, "remove");

    const res = await saveTabs("window", { tabs });

    expect(res.closed).toBe(LIMITS.maxTabsPerSession);
    expect(removeSpy).toHaveBeenCalledWith(
      tabs.slice(0, LIMITS.maxTabsPerSession).map((tab) => tab.id),
    );
  });

  it("asks for confirmation above the threshold and aborts when declined", async () => {
    await seedSettings({
      "general.confirmThreshold": 2,
      "open.openSessionsAfterSave": false,
    });
    const confirm = vi.fn(async () => false);
    const removeSpy = vi.spyOn(fakeBrowser.tabs, "remove");

    const res = await saveTabs("window", { tabs: makeTabs(3), confirm });

    expect(confirm).toHaveBeenCalledWith(3);
    expect(res.session).toBeUndefined();
    expect(res).toMatchObject({ skipped: 0, closed: 0, overflow: 0 });
    await expect(listSessions()).resolves.toEqual([]);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("saves when confirmation is approved", async () => {
    await seedSettings({
      "general.confirmThreshold": 2,
      "open.openSessionsAfterSave": false,
    });
    const confirm = vi.fn(async () => true);

    const res = await saveTabs("window", { tabs: makeTabs(3), confirm });

    expect(confirm).toHaveBeenCalledWith(3);
    expect(res.session?.tabs).toHaveLength(3);
    expect(res.closed).toBe(3);
  });

  it("does not ask for confirmation at or below the threshold", async () => {
    await seedSettings({
      "general.confirmThreshold": 3,
      "open.openSessionsAfterSave": false,
    });
    const confirm = vi.fn(async () => false);

    const res = await saveTabs("window", { tabs: makeTabs(3), confirm });

    expect(confirm).not.toHaveBeenCalled();
    expect(res.session).toBeDefined();
  });

  it("does not ask for confirmation when the threshold is zero", async () => {
    await seedSettings({
      "general.confirmThreshold": 0,
      "open.openSessionsAfterSave": false,
    });
    const confirm = vi.fn(async () => false);

    const res = await saveTabs("window", { tabs: makeTabs(30), confirm });

    expect(confirm).not.toHaveBeenCalled();
    expect(res.session).toBeDefined();
  });

  it("does not ask for confirmation when no confirm hook is provided", async () => {
    await seedSettings({
      "general.confirmThreshold": 1,
      "open.openSessionsAfterSave": false,
    });

    const res = await saveTabs("window", { tabs: makeTabs(5) });

    expect(res.session).toBeDefined();
  });

  it("does not ask for confirmation when no tabs will be closed", async () => {
    await seedSettings({
      "general.confirmThreshold": 1,
      "tabs.closeAfterSave": false,
      "open.openSessionsAfterSave": false,
    });
    const confirm = vi.fn(async () => false);

    const res = await saveTabs("window", { tabs: makeTabs(5), confirm });

    expect(confirm).not.toHaveBeenCalled();
    expect(res.session).toBeDefined();
  });

  it("surfaces LocalQuotaError without closing tabs or opening the sessions page", async () => {
    await seedSettings({ "open.openSessionsAfterSave": true });
    await seedSessions(
      Array.from({ length: LIMITS.maxLocalSessions }, (_, index) =>
        makeSession(`seed-${index}`, []),
      ),
    );
    const removeSpy = vi.spyOn(fakeBrowser.tabs, "remove");
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    await expect(
      saveTabs("window", { tabs: makeTabs(2) }),
    ).rejects.toBeInstanceOf(LocalQuotaError);

    expect(removeSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    await expect(listSessions()).resolves.toHaveLength(
      LIMITS.maxLocalSessions,
    );
  });

  it("awaits the onSaved hook after the session is persisted", async () => {
    await seedSettings({
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    const observed: string[] = [];
    const onSaved = vi.fn(async (session: Session) => {
      const stored = await getSession(session.id);
      observed.push(stored ? "persisted" : "missing");
    });

    const res = await saveTabs("window", { tabs: makeTabs(1), onSaved });

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0]?.[0]).toBe(res.session);
    expect(observed).toEqual(["persisted"]);
  });

  it("runs the onSaved hook before closing saved tabs", async () => {
    await seedSettings({ "open.openSessionsAfterSave": false });
    const removeSpy = vi.spyOn(fakeBrowser.tabs, "remove");
    let removeCalledDuringHook = false;
    const onSaved = vi.fn(async () => {
      removeCalledDuringHook = removeSpy.mock.calls.length > 0;
    });

    await saveTabs("window", { tabs: makeTabs(2, true), onSaved });

    expect(removeCalledDuringHook).toBe(false);
    expect(removeSpy).toHaveBeenCalled();
  });

  it("opens the sessions page after a successful save", async () => {
    await seedSettings({
      "open.openSessionsAfterSave": true,
      "open.reuseSessionsTab": false,
      "tabs.closeAfterSave": false,
    });
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    await saveTabs("window", { tabs: makeTabs(1) });

    expect(createSpy).toHaveBeenCalledWith({
      url: fakeBrowser.runtime.getURL(SESSIONS_PAGE_URL),
    });
  });

  it("does not open the sessions page when the setting is disabled", async () => {
    await seedSettings({
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    await saveTabs("window", { tabs: makeTabs(1) });

    expect(createSpy).not.toHaveBeenCalled();
  });

  it("reuses an existing sessions tab when configured", async () => {
    await seedSettings({
      "open.openSessionsAfterSave": true,
      "open.reuseSessionsTab": true,
      "tabs.closeAfterSave": false,
    });
    const sessionsUrl = fakeBrowser.runtime.getURL(SESSIONS_PAGE_URL);
    const existing = await fakeBrowser.tabs.create({ url: sessionsUrl });
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");
    const updateSpy = vi.spyOn(fakeBrowser.tabs, "update");

    await saveTabs("window", { tabs: makeTabs(1) });

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith(existing.id, { active: true });
  });

  it("uses provided tabs without querying the browser", async () => {
    await seedSettings({
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    const querySpy = vi.spyOn(fakeBrowser.tabs, "query");

    await saveTabs("selection", { tabs: makeTabs(2) });

    expect(querySpy).not.toHaveBeenCalled();
  });

  it("limits a window save to the requested window", async () => {
    await seedSettings({
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
      "tabs.saveAllWindows": true,
    });
    const first = await createWindow(false, true);
    const second = await createWindow();
    await fakeBrowser.tabs.create({
      url: "https://one.example",
      windowId: first.id,
    });
    await fakeBrowser.tabs.create({
      url: "https://two.example",
      windowId: second.id,
    });

    const res = await saveTabs("window", { windowId: first.id });

    expect(res.session?.tabs.map((tab) => tab.url)).toEqual([
      "https://one.example",
    ]);
  });

  it("collects every normal window when all-windows saving is enabled", async () => {
    await seedSettings({
      "tabs.saveAllWindows": true,
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    const first = await createWindow(false, true);
    const second = await createWindow();
    await fakeBrowser.tabs.create({
      url: "https://one.example",
      windowId: first.id,
    });
    await fakeBrowser.tabs.create({
      url: "https://two.example",
      windowId: second.id,
    });

    const res = await saveTabs("all-windows");

    expect(res.session?.tabs.map((tab) => tab.url).sort()).toEqual([
      "https://one.example",
      "https://two.example",
    ]);
  });

  it("excludes popup and app windows from all-windows saves", async () => {
    await seedSettings({
      "tabs.saveAllWindows": true,
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    vi.spyOn(fakeBrowser.windows, "getAll").mockResolvedValue([
      {
        id: 1,
        type: "normal",
        incognito: false,
        tabs: [{ url: "https://normal.example", title: "Normal" }],
      },
      {
        id: 2,
        type: "popup",
        incognito: false,
        tabs: [{ url: "https://popup.example", title: "Popup" }],
      },
      {
        id: 3,
        type: "app",
        incognito: false,
        tabs: [{ url: "https://app.example", title: "App" }],
      },
    ] as unknown as Awaited<ReturnType<typeof fakeBrowser.windows.getAll>>);

    const res = await saveTabs("all-windows");

    expect(res.session?.tabs.map((tab) => tab.url)).toEqual([
      "https://normal.example",
    ]);
  });

  it("fails closed when the target window cannot be resolved", async () => {
    await seedSettings({
      "tabs.saveAllWindows": false,
      "open.openSessionsAfterSave": true,
    });
    vi.spyOn(fakeBrowser.windows, "getCurrent").mockRejectedValue(
      new Error("no current window"),
    );
    vi.spyOn(fakeBrowser.windows, "getLastFocused").mockRejectedValue(
      new Error("no focused window"),
    );
    const querySpy = vi.spyOn(fakeBrowser.tabs, "query");
    const removeSpy = vi.spyOn(fakeBrowser.tabs, "remove");
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    await expect(saveTabs("window")).rejects.toBeInstanceOf(
      WindowUnavailableError,
    );

    expect(querySpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    await expect(listSessions()).resolves.toEqual([]);
  });

  it("falls back to the current window when all-windows saving is disabled", async () => {
    await seedSettings({
      "tabs.saveAllWindows": false,
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    const first = await createWindow(false, true);
    const second = await createWindow();
    await fakeBrowser.tabs.create({
      url: "https://one.example",
      windowId: first.id,
    });
    await fakeBrowser.tabs.create({
      url: "https://two.example",
      windowId: second.id,
    });

    const res = await saveTabs("all-windows");

    expect(res.session?.tabs.map((tab) => tab.url)).toEqual([
      "https://one.example",
    ]);
  });

  it("excludes incognito windows from all-windows saves unless allowed", async () => {
    await seedSettings({
      "tabs.saveAllWindows": true,
      "incognito.includeInSaveAll": false,
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    const normal = await createWindow(false, true);
    const incognito = await createWindow(true);
    await fakeBrowser.tabs.create({
      url: "https://normal.example",
      windowId: normal.id,
    });
    await fakeBrowser.tabs.create({
      url: "https://private.example",
      windowId: incognito.id,
    });

    const res = await saveTabs("all-windows");

    expect(res.session?.tabs.map((tab) => tab.url)).toEqual([
      "https://normal.example",
    ]);
    expect(res.session?.incognito).toBeUndefined();
  });

  it("includes incognito windows and marks the session when configured", async () => {
    await seedSettings({
      "tabs.saveAllWindows": true,
      "incognito.includeInSaveAll": true,
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    const normal = await createWindow(false, true);
    const incognito = await createWindow(true);
    await fakeBrowser.tabs.create({
      url: "https://normal.example",
      windowId: normal.id,
    });
    await fakeBrowser.tabs.create({
      url: "https://private.example",
      windowId: incognito.id,
    });

    const res = await saveTabs("all-windows");

    expect(res.session?.tabs.map((tab) => tab.url).sort()).toEqual([
      "https://normal.example",
      "https://private.example",
    ]);
    expect(res.session?.incognito).toBe(true);
  });

  it("queries the active tab for a tab save", async () => {
    await seedSettings({
      "tabs.saveAllWindows": false,
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    const window = await createWindow(false, true);
    await fakeBrowser.tabs.create({
      url: "https://active.example",
      windowId: window.id,
      active: true,
    });

    const res = await saveTabs("tab");

    expect(res.session?.tabs.map((tab) => tab.url)).toEqual([
      "https://active.example",
    ]);
  });
});
