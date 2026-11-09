import { createTranslator, type SavedTab, type Session } from "@savetabs/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSIONS_DB_NAME, closeSessionsDb } from "../lib/sessions-db";
import { addSession, getSession } from "../lib/sessions-repo";
import { SessionCard, type SessionCardProps } from "./SessionCard";

const t = createTranslator("en");
const MINUTE_MS = 60_000;

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

const DEFAULT_TABS: SavedTab[] = [
  {
    url: "https://example.com/article",
    title: "Example article",
    favIconUrl: "https://example.com/favicon.ico",
  },
  { url: "https://docs.example.org/guide", title: "Guide" },
];

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: "window",
    tabs: DEFAULT_TABS,
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

function renderCard(overrides: Partial<SessionCardProps> = {}) {
  const props: SessionCardProps = {
    session: makeSession(),
    expanded: true,
    onToggleExpanded: vi.fn(),
    displayMode: "title",
    showFavicons: true,
    showTabCount: true,
    clipboardFormat: "plain-urls",
    lang: "en",
    t,
    onRestore: vi.fn(),
    onDelete: vi.fn(),
    onChanged: vi.fn(),
    onNotify: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<SessionCard {...props} />) };
}

function restoreClipboard(): void {
  if (originalClipboard === undefined) {
    Reflect.deleteProperty(navigator, "clipboard");
  } else {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  }
  Reflect.deleteProperty(document, "execCommand");
}

beforeEach(async () => {
  fakeBrowser.reset();
  await closeSessionsDb();
  await deleteDatabase();
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  restoreClipboard();
  await closeSessionsDb();
});

describe("SessionCard", () => {
  it("renders an accessible region with the session title and relative time", () => {
    const session = makeSession({
      title: "Example session",
      createdAt: Date.now() - 5 * MINUTE_MS - 1_000,
    });
    renderCard({ session });

    const card = screen.getByRole("region", { name: "Example session" });
    expect(card).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Example session" }),
    ).toBeInTheDocument();

    const time = screen.getByText("5 minutes ago");
    const expectedAbsolute = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(session.createdAt));
    expect(time).toHaveAttribute("title", expectedAbsolute);
    expect(time.tagName.toLowerCase()).toBe("time");
  });

  it("falls back to the relative timestamp as the card heading", () => {
    renderCard({ session: makeSession({ title: undefined }) });

    expect(
      screen.getByRole("region", { name: "Just now" }),
    ).toBeInTheDocument();
  });

  it("shows the tab count only when the setting is enabled", () => {
    renderCard();

    expect(screen.getByText("2 tabs")).toBeInTheDocument();
  });

  it("hides the tab count when the setting is disabled", () => {
    renderCard({ showTabCount: false });

    expect(screen.queryByText("2 tabs")).not.toBeInTheDocument();
  });

  it("labels incognito sessions as private", () => {
    renderCard({ session: makeSession({ incognito: true }) });

    expect(screen.getByText("Private")).toBeInTheDocument();
  });

  it("does not label normal sessions as private", () => {
    renderCard();

    expect(screen.queryByText("Private")).not.toBeInTheDocument();
  });

  it("shows tab titles and always exposes the full URL in the tooltip", () => {
    renderCard({ displayMode: "title" });

    const first = screen.getByRole("link", { name: "Example article" });
    const second = screen.getByRole("link", { name: "Guide" });

    expect(first).toHaveAttribute("title", "https://example.com/article");
    expect(second).toHaveAttribute("title", "https://docs.example.org/guide");
    expect(first).toHaveAttribute("href", "https://example.com/article");
    expect(first).toHaveAttribute("target", "_blank");
  });

  it("falls back to the URL when a tab has no title", () => {
    renderCard({
      session: makeSession({
        tabs: [{ url: "https://example.com/untitled", title: "" }],
      }),
    });

    expect(
      screen.getByRole("link", { name: "https://example.com/untitled" }),
    ).toBeInTheDocument();
  });

  it("shows domains in domain display mode", () => {
    renderCard({ displayMode: "domain" });

    expect(
      screen.getByRole("link", { name: "example.com" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "docs.example.org" }),
    ).toBeInTheDocument();
  });

  it("shows full URLs in full-url display mode", () => {
    renderCard({ displayMode: "full-url" });

    expect(
      screen.getByRole("link", { name: "https://example.com/article" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://docs.example.org/guide" }),
    ).toBeInTheDocument();
  });

  it("shows favicons when enabled", () => {
    const { container } = renderCard({ showFavicons: true });

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("src", "https://example.com/favicon.ico");
    expect(image).toHaveAttribute("alt", "");
  });

  it("hides favicons when disabled", () => {
    const { container } = renderCard({ showFavicons: false });

    expect(container.querySelector("img")).toBeNull();
  });

  it("toggles the tab list through the expand control", async () => {
    const { props } = renderCard({ expanded: false });

    expect(
      screen.queryByRole("link", { name: "Example article" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show tabs" }));

    expect(props.onToggleExpanded).toHaveBeenCalledTimes(1);
  });

  it("offers a collapse control when expanded", () => {
    renderCard({ expanded: true });

    expect(
      screen.getByRole("button", { name: "Hide tabs" }),
    ).toBeInTheDocument();
  });

  it("restores the session", async () => {
    const { props } = renderCard();

    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(props.onRestore).toHaveBeenCalledTimes(1);
  });

  it("copies tabs using the configured clipboard format", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { props } = renderCard({ clipboardFormat: "markdown" });

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(
      "- [Example article](https://example.com/article)\n- [Guide](https://docs.example.org/guide)",
    );
    expect(props.onNotify).toHaveBeenCalledWith(
      "success",
      "Copied 2 tabs to the clipboard.",
    );
  });

  it("copies through the textarea fallback when the clipboard API is unavailable", async () => {
    Reflect.deleteProperty(navigator, "clipboard");
    let selectedValue: string | undefined;
    vi.spyOn(HTMLTextAreaElement.prototype, "select").mockImplementation(
      function (this: HTMLTextAreaElement) {
        selectedValue = this.value;
      },
    );
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    renderCard({ clipboardFormat: "plain-urls" });

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(selectedValue).toBe(
      "https://example.com/article\nhttps://docs.example.org/guide",
    );
    // The temporary fallback is removed; only the visible URL list remains.
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
  });

  it("reports a copy failure when both clipboard paths fail", async () => {
    Reflect.deleteProperty(navigator, "clipboard");
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    const { props } = renderCard();

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(props.onNotify).toHaveBeenCalledWith(
      "error",
      "Could not copy the tabs.",
    );
  });

  it("lists every tab URL in one read-only text area", () => {
    renderCard();

    const field = screen.getByRole("textbox", { name: "All URLs" });

    expect(field).toHaveValue(
      "https://example.com/article\nhttps://docs.example.org/guide",
    );
    expect(field).toHaveAttribute("readonly");
  });

  it("asks for confirmation before deleting and cancels safely", async () => {
    const { props } = renderCard();

    await userEvent.click(
      screen.getByRole("button", { name: "More actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("deletes the session after confirmation", async () => {
    const { props } = renderCard();

    await userEvent.click(
      screen.getByRole("button", { name: "More actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Delete session" }),
    );

    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renames the session inline through the repository", async () => {
    const session = makeSession({ title: "Work" });
    await addSession(session);
    const { props } = renderCard({ session });

    await userEvent.click(
      screen.getByRole("button", { name: "More actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox", { name: "Session name" });
    expect(input).toHaveValue("Work");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed session");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(async () => {
      expect((await getSession(session.id))?.title).toBe("Renamed session");
    });
    expect(props.onChanged).toHaveBeenCalled();
    expect(props.onNotify).toHaveBeenCalledWith("success", "Session renamed.");
    expect(
      screen.queryByRole("textbox", { name: "Session name" }),
    ).not.toBeInTheDocument();
  });

  it("cancels an inline rename without touching the repository", async () => {
    const session = makeSession({ title: "Work" });
    await addSession(session);
    renderCard({ session });

    await userEvent.click(
      screen.getByRole("button", { name: "More actions" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Session name" }),
      " changed",
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect((await getSession(session.id))?.title).toBe("Work");
    expect(
      screen.getByRole("heading", { name: "Work" }),
    ).toBeInTheDocument();
  });
});
