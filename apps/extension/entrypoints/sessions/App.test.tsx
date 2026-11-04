import { DEFAULT_SETTINGS, type Session } from "@savetabs/shared";
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

import { SESSIONS_DB_NAME, closeSessionsDb } from "../../lib/sessions-db";
import { addSession } from "../../lib/sessions-repo";
import { resetSettings } from "../../lib/settings";
import { App } from "./App";

const HOUR_MS = 60 * 60 * 1000;

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

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

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SESSIONS_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("deleteDatabase failed"));
    request.onblocked = () => reject(new Error("deleteDatabase blocked"));
  });
}

async function seedSettings(overrides: Record<string, unknown> = {}): Promise<void> {
  await fakeBrowser.storage.local.set({
    settings: { ...DEFAULT_SETTINGS, ...overrides },
  });
}

function restoreClipboard(): void {
  if (originalClipboard === undefined) {
    Reflect.deleteProperty(navigator, "clipboard");
  } else {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  }
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
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  restoreClipboard();
  await closeSessionsDb();
  fakeBrowser.reset();
});

describe("sessions page", () => {
  it("renders sessions newest first and expands only the newest card", async () => {
    const now = Date.now();
    await addSession(
      makeSession({
        id: "older",
        title: "Older session",
        createdAt: now - 2 * HOUR_MS,
        updatedAt: now - 2 * HOUR_MS,
        tabs: [{ url: "https://older.example.com", title: "Old tab" }],
      }),
    );
    await addSession(
      makeSession({
        id: "newest",
        title: "Newest session",
        createdAt: now,
        updatedAt: now,
        tabs: [{ url: "https://newest.example.com", title: "New tab" }],
      }),
    );

    render(<App />);

    const newest = await screen.findByRole("region", {
      name: "Newest session",
    });
    const older = screen.getByRole("region", { name: "Older session" });
    expect(screen.getAllByRole("region")[0]).toBe(newest);

    expect(
      within(newest).getByRole("link", { name: "New tab" }),
    ).toBeInTheDocument();
    expect(
      within(older).queryByRole("link", { name: "Old tab" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(older).getByRole("button", { name: "Show tabs" }),
    );
    expect(
      within(older).getByRole("link", { name: "Old tab" }),
    ).toBeInTheDocument();
  });

  it("renders the page header with brand, search, save and theme controls", async () => {
    await addSession(makeSession({ title: "A session" }));

    render(<App />);

    await screen.findByRole("region", { name: "A session" });
    expect(
      screen.getByRole("heading", { level: 1, name: /SaveTabs/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Search sessions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save window" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Theme:/ }),
    ).toBeInTheDocument();
  });

  it("sends SAVE_TABS for the save window button and refreshes", async () => {
    const sendMessage = stubSendMessage({
      ok: true,
      data: {
        session: makeSession({ tabs: [{ url: "https://a.example", title: "A" }] }),
        skipped: 0,
        closed: 0,
        overflow: 0,
      },
    });
    await addSession(makeSession({ title: "A session" }));

    render(<App />);

    await screen.findByRole("region", { name: "A session" });
    await userEvent.click(screen.getByRole("button", { name: "Save window" }));

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
        session: makeSession({
          tabs: Array.from({ length: 500 }, (_, index) => ({
            url: `https://full-${index}.example`,
            title: `Tab ${index}`,
          })),
        }),
        skipped: 2,
        closed: 500,
        overflow: 2,
      },
    });
    await addSession(makeSession({ title: "A session" }));

    render(<App />);

    await screen.findByRole("region", { name: "A session" });
    await userEvent.click(screen.getByRole("button", { name: "Save window" }));

    expect(
      await screen.findByText(
        "Saved 500 tabs; 2 left open (session limit).",
      ),
    ).toBeInTheDocument();
  });

  it("asks for confirmation and resends the save with confirmed true", async () => {
    const sendMessage = stubSendMessage(
      { ok: false, code: "confirmation_required", data: { count: 21 } },
      {
        ok: true,
        data: {
          session: makeSession({
            tabs: [{ url: "https://a.example", title: "A" }],
          }),
          skipped: 0,
          closed: 21,
          overflow: 0,
        },
      },
    );
    await addSession(makeSession({ title: "A session" }));

    render(<App />);

    await screen.findByRole("region", { name: "A session" });
    await userEvent.click(screen.getByRole("button", { name: "Save window" }));

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
    await addSession(makeSession({ title: "A session" }));

    render(<App />);

    await screen.findByRole("region", { name: "A session" });
    await userEvent.click(screen.getByRole("button", { name: "Save window" }));

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

  it("shows a localized error when the background reply is invalid", async () => {
    stubSendMessage({ ok: true });
    await addSession(makeSession({ id: "restore-me", title: "Restore me" }));

    render(<App />);

    const card = await screen.findByRole("region", { name: "Restore me" });
    await userEvent.click(within(card).getByRole("button", { name: "Restore" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The extension returned an unexpected response.",
    );
  });

  it("sends RESTORE_SESSION for the card restore action", async () => {
    const sendMessage = stubSendMessage({ ok: true, data: { opened: 3 } });
    await addSession(makeSession({ id: "restore-me", title: "Restore me" }));

    render(<App />);

    const card = await screen.findByRole("region", { name: "Restore me" });
    await userEvent.click(within(card).getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: "RESTORE_SESSION",
        sessionId: "restore-me",
      }),
    );
    expect(await screen.findByText("Restored 3 tabs.")).toBeInTheDocument();
  });

  it("shows a visible error when the background rejects an action", async () => {
    stubSendMessage({
      ok: false,
      code: "not_found",
    });
    await addSession(makeSession({ id: "gone", title: "Gone" }));

    render(<App />);

    const card = await screen.findByRole("region", { name: "Gone" });
    await userEvent.click(within(card).getByRole("button", { name: "Restore" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("That session no longer exists.");
  });

  it("sends DELETE_SESSION only after the confirmation", async () => {
    const sendMessage = stubSendMessage({
      ok: true,
      data: { deleted: "delete-me" },
    });
    await addSession(makeSession({ id: "delete-me", title: "Delete me" }));

    render(<App />);

    const card = await screen.findByRole("region", { name: "Delete me" });
    await userEvent.click(
      within(card).getByRole("button", { name: "More actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(sendMessage).not.toHaveBeenCalledWith({
      type: "DELETE_SESSION",
      sessionId: "delete-me",
    });

    await userEvent.click(
      within(card).getByRole("button", { name: "More actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Delete session" }),
    );

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: "DELETE_SESSION",
        sessionId: "delete-me",
      }),
    );
    expect(await screen.findByText("Session deleted.")).toBeInTheDocument();
  });

  it("copies tabs using the clipboard format from settings", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await seedSettings({ "clipboard.format": "markdown" });
    await addSession(
      makeSession({
        title: "Copy me",
        tabs: [{ url: "https://example.com/copy", title: "Copy target" }],
      }),
    );

    render(<App />);

    const card = await screen.findByRole("region", { name: "Copy me" });
    await userEvent.click(within(card).getByRole("button", { name: "Copy" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "- [Copy target](https://example.com/copy)",
      ),
    );
    expect(
      await screen.findByText("Copied 1 tabs to the clipboard."),
    ).toBeInTheDocument();
  });

  it("filters sessions by session title, tab title and tab URL", async () => {
    await addSession(
      makeSession({
        id: "rust",
        title: "Rust reading",
        tabs: [{ url: "https://doc.rust-lang.org/book", title: "The Book" }],
      }),
    );
    await addSession(
      makeSession({
        id: "news",
        title: "Daily news",
        tabs: [{ url: "https://news.example.com", title: "Headlines" }],
      }),
    );

    render(<App />);

    await screen.findByRole("region", { name: "Rust reading" });
    const search = screen.getByRole("searchbox", { name: "Search sessions" });

    await userEvent.type(search, "rust reading");
    expect(
      screen.getByRole("region", { name: "Rust reading" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Daily news" }),
    ).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, "headlines");
    expect(
      screen.getByRole("region", { name: "Daily news" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Rust reading" }),
    ).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, "doc.rust-lang.org");
    expect(
      screen.getByRole("region", { name: "Rust reading" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Daily news" }),
    ).not.toBeInTheDocument();
  });

  it("shows a no-results message when the search matches nothing", async () => {
    await addSession(makeSession({ title: "A session" }));

    render(<App />);

    await screen.findByRole("region", { name: "A session" });
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search sessions" }),
      "zzzz-no-match",
    );

    expect(
      screen.getByText("No sessions match your search."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });

  it("guides the user to save tabs when there are no sessions", async () => {
    render(<App />);

    expect(
      await screen.findByText(
        "No sessions yet. Save your open tabs with the Save window button.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });
});
