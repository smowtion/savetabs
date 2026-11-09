import {
  DEFAULT_SETTINGS,
  SyncAuthError,
  generateKey,
  type SavedTab,
  type Session,
} from "@savetabs/shared";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DISCARD_STATS_KEY } from "../../lib/discard";
import { SESSIONS_DB_NAME, closeSessionsDb } from "../../lib/sessions-db";
import { addSession } from "../../lib/sessions-repo";
import { resetSettings } from "../../lib/settings";
import { syncNow } from "../../lib/sync/sync-service";
import {
  LATEST_VERSION_STORAGE_KEY,
  UPDATE_AVAILABLE_STORAGE_KEY,
  currentBrowser,
  storeListingUrl,
} from "../../lib/version-check";
import { App } from "./App";

vi.mock("../../lib/sync/sync-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/sync/sync-service")>();
  return { ...actual, syncNow: vi.fn() };
});

const syncNowMock = vi.mocked(syncNow);

const HOUR_MS = 60 * 60 * 1000;
/** The fake browser focuses the first window created after a reset. */
const FOCUSED_WINDOW_ID = 1;

function stubMatchMedia(matches = false): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    id: `session-${Math.random().toString(36).slice(2)}`,
    createdAt: now,
    updatedAt: now,
    source: "window",
    tabs: [{ url: "https://example.com", title: "Example" }],
    ...overrides,
  };
}

/** `count` saved tabs with unique URLs. */
function savedTabs(count: number, prefix = "tab"): SavedTab[] {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://${prefix}-${index}.example`,
    title: `${prefix} ${index}`,
  }));
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

async function seedSettings(
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await fakeBrowser.storage.local.set({
    settings: { ...DEFAULT_SETTINGS, ...overrides },
  });
}

/** Local calendar day used by the discard counter (`YYYY-MM-DD`). */
function localDate(now = Date.now()): string {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

async function seedTab(url: string, pinned = false): Promise<void> {
  await fakeBrowser.tabs.create({
    url,
    windowId: FOCUSED_WINDOW_ID,
    pinned,
  });
}

/**
 * Create a real `normal` window. The save scope only considers normal windows
 * for all-windows saves, so tests that exercise that path need the type.
 */
async function createNormalWindow(
  options: { focused?: boolean; incognito?: boolean } = {},
): Promise<number> {
  const created = await fakeBrowser.windows.create({
    focused: options.focused ?? false,
    incognito: options.incognito ?? false,
    type: "normal",
  });
  if (created?.id === undefined) {
    throw new Error("fakeBrowser.windows.create returned no window id");
  }
  return created.id;
}

/**
 * fakeBrowser types `runtime.sendMessage` as returning void because the
 * default fake has no background listener; the tests answer with typed
 * UiResponses instead, so the stub casts each reply. Multiple replies are
 * consumed in order for the two-phase save confirmation.
 */
function stubSendMessage(...responses: unknown[]) {
  const sendMessage = vi.spyOn(fakeBrowser.runtime, "sendMessage");
  for (const response of responses) {
    sendMessage.mockResolvedValueOnce(response as never);
  }
  return sendMessage;
}

beforeEach(async () => {
  fakeBrowser.reset();
  await resetSettings();
  fakeBrowser.reset();
  await closeSessionsDb();
  await deleteDatabase();
  document.documentElement.removeAttribute("data-theme");
  stubMatchMedia();
  syncNowMock.mockReset();
  syncNowMock.mockResolvedValue({
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    errors: [],
  });
  // `windows.getCurrent()` and all-window saves need a real normal window.
  await createNormalWindow({ focused: true });
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await closeSessionsDb();
  fakeBrowser.reset();
});

describe("popup", () => {
  it("labels the save button with the filtered current-window tab count", async () => {
    await seedSettings({
      "tabs.excludedDomains": ["excluded.example"],
      "duplicates.skipAlreadySaved": true,
    });
    await addSession(
      makeSession({
        tabs: [{ url: "https://already.example", title: "Already saved" }],
      }),
    );
    await seedTab("https://keep-one.example");
    await seedTab("https://keep-two.example");
    await seedTab("chrome://settings");
    await seedTab("https://pinned.example", true);
    await seedTab("https://keep-one.example");
    await seedTab("https://excluded.example");
    await seedTab("https://already.example");

    render(<App />);

    // Seven raw tabs; only two survive every save filter.
    expect(
      await screen.findByRole("button", { name: "Save 2 tabs" }),
    ).toBeInTheDocument();
  });

  it("counts tabs from every normal window when all-windows saving is enabled", async () => {
    await seedSettings({ "tabs.saveAllWindows": true });
    const otherWindow = await createNormalWindow();
    await seedTab("https://current-one.example");
    await seedTab("https://current-two.example");
    for (let index = 0; index < 10; index += 1) {
      await fakeBrowser.tabs.create({
        url: `https://other-${index}.example`,
        windowId: otherWindow,
      });
    }

    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Save 12 tabs" }),
    ).toBeInTheDocument();
  });

  it("counts only the current window when all-windows saving is disabled", async () => {
    const otherWindow = await createNormalWindow();
    await seedTab("https://current.example");
    await fakeBrowser.tabs.create({
      url: "https://other.example",
      windowId: otherWindow,
    });

    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Save 1 tabs" }),
    ).toBeInTheDocument();
  });

  it("excludes incognito windows from the count unless the setting allows them", async () => {
    await seedSettings({
      "tabs.saveAllWindows": true,
      "incognito.includeInSaveAll": false,
    });
    const incognitoWindow = await createNormalWindow({ incognito: true });
    await seedTab("https://normal.example");
    await fakeBrowser.tabs.create({
      url: "https://private-one.example",
      windowId: incognitoWindow,
    });
    await fakeBrowser.tabs.create({
      url: "https://private-two.example",
      windowId: incognitoWindow,
    });

    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Save 1 tabs" }),
    ).toBeInTheDocument();

    await fakeBrowser.storage.local.set({
      settings: {
        ...DEFAULT_SETTINGS,
        "tabs.saveAllWindows": true,
        "incognito.includeInSaveAll": true,
      },
    });

    expect(
      await screen.findByRole("button", { name: "Save 3 tabs" }),
    ).toBeInTheDocument();
  });

  it("sends SAVE_TABS for the current window and reports the save", async () => {
    const sendMessage = stubSendMessage({
      ok: true,
      data: {
        session: makeSession({ tabs: savedTabs(1) }),
        skipped: 0,
        closed: 1,
        overflow: 0,
      },
    });
    await seedTab("https://a.example");

    render(<App />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Save 1 tabs" }),
    );

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: "SAVE_TABS",
        source: "window",
      }),
    );
    expect(await screen.findByText("Saved 1 tabs.")).toBeInTheDocument();
  });

  it("reports tabs left open when the session limit is reached", async () => {
    stubSendMessage({
      ok: true,
      data: {
        session: makeSession({ tabs: savedTabs(500) }),
        skipped: 3,
        closed: 500,
        overflow: 3,
      },
    });
    await seedTab("https://a.example");

    render(<App />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Save 1 tabs" }),
    );

    expect(
      await screen.findByText(
        "Saved 500 tabs; 3 left open (session limit).",
      ),
    ).toBeInTheDocument();
  });

  it("discards inactive tabs from the popup", async () => {
    const sendMessage = stubSendMessage({
      ok: true,
      data: { discarded: 2 },
    });
    await seedTab("https://a.example");

    render(<App />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Discard now" }),
    );

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({ type: "DISCARD_NOW" }),
    );
    expect(await screen.findByText("Discarded 2 tabs.")).toBeInTheDocument();
  });

  it("asks for confirmation and resends the save with confirmed true", async () => {
    const sendMessage = stubSendMessage(
      { ok: false, code: "confirmation_required", data: { count: 21 } },
      {
        ok: true,
        data: {
          session: makeSession({ tabs: savedTabs(1) }),
          skipped: 0,
          closed: 21,
          overflow: 0,
        },
      },
    );
    await seedTab("https://a.example");

    render(<App />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Save 1 tabs" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Saving will close 21 tabs. Continue?");
    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      type: "SAVE_TABS",
      source: "window",
    });

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save and close" }),
    );

    await waitFor(() =>
      expect(sendMessage).toHaveBeenNthCalledWith(2, {
        type: "SAVE_TABS",
        source: "window",
        confirmed: true,
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("Saved 1 tabs.")).toBeInTheDocument();
  });

  it("does not resend the save when the confirmation is cancelled", async () => {
    const sendMessage = stubSendMessage({
      ok: false,
      code: "confirmation_required",
      data: { count: 21 },
    });
    await seedTab("https://a.example");

    render(<App />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Save 1 tabs" }),
    );

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      type: "SAVE_TABS",
      source: "window",
    });
  });

  it("lists only the three most recent sessions", async () => {
    const now = Date.now();
    for (let index = 0; index < 4; index += 1) {
      await addSession(
        makeSession({
          id: `session-${index}`,
          createdAt: now - index * HOUR_MS,
          updatedAt: now - index * HOUR_MS,
          tabs: savedTabs(4 - index, `session-${index}`),
        }),
      );
    }

    render(<App />);

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("4 tabs");
    expect(items[1]).toHaveTextContent("3 tabs");
    expect(items[2]).toHaveTextContent("2 tabs");
    // The oldest session (1 tab) is not rendered.
    expect(screen.queryByText("1 tabs")).not.toBeInTheDocument();
  });

  it("sends RESTORE_SESSION for a recent session", async () => {
    const sendMessage = stubSendMessage({ ok: true, data: { opened: 2 } });
    await addSession(
      makeSession({
        id: "restore-me",
        tabs: savedTabs(2, "restore"),
      }),
    );

    render(<App />);

    const restore = await screen.findByRole("button", {
      name: /^Restore /,
    });
    await userEvent.click(restore);

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: "RESTORE_SESSION",
        sessionId: "restore-me",
      }),
    );
    expect(await screen.findByText("Restored 2 tabs.")).toBeInTheDocument();
  });

  it("opens the sessions page and the options page", async () => {
    const getUrl = vi
      .spyOn(fakeBrowser.runtime, "getURL")
      .mockReturnValue("chrome-extension://test/sessions.html");
    const createTab = vi
      .spyOn(fakeBrowser.tabs, "create")
      .mockResolvedValue({} as never);
    const openOptionsPage = vi
      .spyOn(fakeBrowser.runtime, "openOptionsPage")
      .mockResolvedValue(undefined);

    render(<App />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Open sessions page" }),
    );

    expect(getUrl).toHaveBeenCalledWith("/sessions.html");
    expect(createTab).toHaveBeenCalledWith({
      url: "chrome-extension://test/sessions.html",
    });

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it("hides the auto-discard status when the browser cannot discard tabs", async () => {
    const originalDiscard = fakeBrowser.tabs.discard;
    Object.defineProperty(fakeBrowser.tabs, "discard", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      render(<App />);

      await screen.findByRole("button", { name: /^Save \d+ tabs$/ });
      expect(screen.queryByText(/Auto-discard:/)).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(fakeBrowser.tabs, "discard", {
        value: originalDiscard,
        configurable: true,
        writable: true,
      });
    }
  });

  it("shows Off when auto-discard is disabled", async () => {
    await seedSettings({ "memory.autoDiscard": false });

    render(<App />);

    expect(await screen.findByText("Auto-discard: Off")).toBeInTheDocument();
  });

  it("shows the timeout and today's discarded count", async () => {
    await seedSettings({
      "memory.autoDiscard": true,
      "memory.timeoutMinutes": 15,
    });
    await fakeBrowser.storage.local.set({
      [DISCARD_STATS_KEY]: { date: localDate(), count: 7 },
    });

    render(<App />);

    expect(
      await screen.findByText(
        "Auto-discard: 15 min · 7 discarded today",
      ),
    ).toBeInTheDocument();
  });

  it("recomputes the count when settings change while open", async () => {
    await seedTab("https://a.example");
    await seedTab("https://b.example");
    await seedTab("https://c.example");

    render(<App />);

    await screen.findByRole("button", { name: "Save 3 tabs" });

    await fakeBrowser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, "tabs.excludedDomains": ["a.example"] },
    });

    expect(
      await screen.findByRole("button", { name: "Save 2 tabs" }),
    ).toBeInTheDocument();
  });

  it("refreshes the recent sessions when another context saves one", async () => {
    render(<App />);

    expect(
      await screen.findByText("No saved sessions yet."),
    ).toBeInTheDocument();

    await addSession(
      makeSession({ id: "from-other-context", tabs: savedTabs(2, "other") }),
    );

    expect(await screen.findByRole("listitem")).toHaveTextContent("2 tabs");
  });

  it("shows sync off without a key and sync on once both are enabled", async () => {
    await seedSettings({ "sync.enabled": true });

    render(<App />);

    expect(await screen.findByText("Sync off")).toBeInTheDocument();

    await fakeBrowser.storage.local.set({ syncKey: generateKey() });

    expect(await screen.findByText("Sync on")).toBeInTheDocument();
  });

  it("renders every label in the selected language", async () => {
    await seedSettings({ "general.language": "vi" });
    await seedTab("https://a.example");

    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Lưu 1 tab" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mở trang phiên" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cài đặt" })).toBeInTheDocument();
  });

  it("shows the update banner and opens the browser's store listing", async () => {
    await seedSettings();
    await fakeBrowser.storage.local.set({
      [UPDATE_AVAILABLE_STORAGE_KEY]: true,
      [LATEST_VERSION_STORAGE_KEY]: "1.2.3",
    });
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    render(<App />);

    expect(await screen.findByText("Update available")).toBeInTheDocument();
    expect(
      screen.getByText("SaveTabs 1.2.3 is ready to install."),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "View in store" }),
    );

    expect(createSpy).toHaveBeenCalledWith({
      url: storeListingUrl(currentBrowser()),
    });
  });

  it("hides the update banner when no update is recorded", async () => {
    await seedSettings();

    render(<App />);

    await waitFor(() =>
      expect(screen.queryByText("Update available")).not.toBeInTheDocument(),
    );
  });

  it("changes the language from the popup header and persists it", async () => {
    await seedSettings();
    await seedTab("https://a.example");

    render(<App />);

    const picker = await screen.findByRole("combobox", { name: "Language" });
    await userEvent.selectOptions(picker, "vi");

    expect(
      await screen.findByRole("button", { name: "Lưu 1 tab" }),
    ).toBeInTheDocument();
    await waitFor(async () => {
      const stored = await fakeBrowser.storage.local.get("settings");
      const settings = stored.settings as Record<string, unknown>;
      expect(settings["general.language"]).toBe("vi");
    });
  });

  it("enables sync with one click and runs a full sync", async () => {
    await seedSettings();
    syncNowMock.mockResolvedValue({
      uploaded: 2,
      downloaded: 1,
      deleted: 0,
      errors: [],
    });

    render(<App />);

    expect(await screen.findByText("Sync off")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enable sync" }));

    expect(
      await screen.findByText("Turn on encrypted sync"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^ST-/)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Enable & sync now" }),
    );

    await waitFor(() => expect(syncNowMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Sync on")).toBeInTheDocument();
    expect(
      await screen.findByText("Uploaded 2, downloaded 1, deleted 0."),
    ).toBeInTheDocument();
    const stored = await fakeBrowser.storage.local.get("settings");
    const settings = stored.settings as Record<string, unknown>;
    expect(settings["sync.enabled"]).toBe(true);
  });

  it("uses a pasted key when enabling sync", async () => {
    await seedSettings();
    const existingKey = generateKey();

    render(<App />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Enable sync" }),
    );
    const input = await screen.findByLabelText("Import key");
    await userEvent.type(input, existingKey);
    await userEvent.click(
      screen.getByRole("button", { name: "Enable & sync now" }),
    );

    await waitFor(() => expect(syncNowMock).toHaveBeenCalledTimes(1));
    const stored = await fakeBrowser.storage.local.get("syncKey");
    expect(stored.syncKey).toBe(existingKey);
  });

  it("runs a sync from the popup when sync is already on", async () => {
    await seedSettings({ "sync.enabled": true });
    await fakeBrowser.storage.local.set({ syncKey: generateKey() });

    render(<App />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Sync now" }),
    );

    await waitFor(() => expect(syncNowMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("Uploaded 0, downloaded 0, deleted 0."),
    ).toBeInTheDocument();
  });

  it("shows a rejected-key error instead of a successful sync", async () => {
    await seedSettings({ "sync.enabled": true });
    await fakeBrowser.storage.local.set({ syncKey: generateKey() });
    syncNowMock.mockRejectedValue(new SyncAuthError());

    render(<App />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Sync now" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The sync key was rejected or the cloud data cannot be decrypted. Re-import or rotate your key.",
    );
  });
});
