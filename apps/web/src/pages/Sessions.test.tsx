import {
  encryptSession,
  missingKeys,
  type Session,
} from "@savetabs/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import { deriveForWeb, loadKey, saveKeyForSession } from "../lib/key-session";
import Sessions from "./Sessions";

/** A syntactically valid key: ST- prefix plus 26 Crockford symbols. */
const VALID_KEY = "ST-00000-00000-00000-00000-00000-0";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const OLDER_ID = "22222222-2222-4222-8222-222222222222";

const WEB_SESSION_KEYS = [
  "web.sessions.title",
  "web.sessions.searchLabel",
  "web.sessions.searchPlaceholder",
  "web.sessions.noResults",
  "web.sessions.empty",
  "web.sessions.restore",
  "web.sessions.restoreHint",
  "web.sessions.restoreSuccess",
  "web.sessions.popupBlocked",
  "web.sessions.copy",
  "web.sessions.copySuccess",
  "web.sessions.copyFailed",
  "web.sessions.export",
  "web.sessions.exportSuccess",
  "web.sessions.exportFailed",
  "web.sessions.delete",
  "web.sessions.deleteTitle",
  "web.sessions.deleteMessage",
  "web.sessions.deleteConfirm",
  "web.sessions.deleteSuccess",
  "web.sessions.deleteFailed",
  "web.sessions.authError",
  "web.sessions.changeKey",
  "web.sessions.decryptError",
  "web.sessions.loadFailed",
  "web.sessions.noTabs",
];

function sessionFixture(overrides: Partial<Session> = {}): Session {
  return {
    id: SESSION_ID,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    source: "window",
    tabs: [
      { url: "https://example.com/a", title: "Example A" },
      { url: "https://docs.example.com/b", title: "Docs B" },
    ],
    ...overrides,
  };
}

async function encryptedBlob(session: Session) {
  const { authId, encKey } = await deriveForWeb(VALID_KEY);
  return {
    id: session.id,
    ciphertext: await encryptSession(encKey, authId, session),
    updatedAt: session.updatedAt,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchHandler = (
  url: string,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

function mockFetch(handler: FetchHandler) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderSessions() {
  return render(
    <MemoryRouter initialEntries={["/sessions"]}>
      <Routes>
        <Route path="/" element={<div data-testid="landing-page" />} />
        <Route path="/sessions" element={<Sessions />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  saveKeyForSession(VALID_KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  delete document.documentElement.dataset.theme;
  localStorage.clear();
  sessionStorage.clear();
});

describe("Sessions page", () => {
  it("decrypts stored sessions and renders cards newest first", async () => {
    const older = sessionFixture({
      id: OLDER_ID,
      title: "Older reading",
      createdAt: 1_600_000_000_000,
      updatedAt: 1_600_000_000_000,
      tabs: [{ url: "https://older.example.com", title: "Older tab" }],
    });
    const newer = sessionFixture({ title: "Morning reading" });
    const [olderBlob, newerBlob] = await Promise.all([
      encryptedBlob(older),
      encryptedBlob(newer),
    ]);
    mockFetch(() => jsonResponse({ blobs: [olderBlob, newerBlob] }));

    renderSessions();

    expect(
      await screen.findByRole("heading", { name: "Morning reading" }),
    ).toBeInTheDocument();

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Morning reading",
      "Older reading",
    ]);

    const newerCard = screen
      .getByRole("heading", { name: "Morning reading" })
      .closest("section");
    expect(newerCard).not.toBeNull();
    expect(
      within(newerCard as HTMLElement).getByText("2 tabs"),
    ).toBeInTheDocument();

    const link = within(newerCard as HTMLElement).getByRole("link", {
      name: /Example A/,
    });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("example.com");
  });

  it("loads every blob page until no next page remains", async () => {
    const first = sessionFixture({ title: "First page" });
    const second = sessionFixture({
      id: OLDER_ID,
      title: "Second page",
      createdAt: 1_650_000_000_000,
      updatedAt: 1_650_000_000_000,
    });
    const [firstBlob, secondBlob] = await Promise.all([
      encryptedBlob(first),
      encryptedBlob(second),
    ]);
    const fetchMock = mockFetch((url) =>
      url.includes("page=0")
        ? jsonResponse({ blobs: [firstBlob], nextPage: 1 })
        : jsonResponse({ blobs: [secondBlob] }),
    );

    renderSessions();

    expect(await screen.findByText("First page")).toBeInTheDocument();
    expect(await screen.findByText("Second page")).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("page=0&pageSize=50"))).toBe(true);
    expect(urls.some((url) => url.includes("page=1&pageSize=50"))).toBe(true);
  });

  it("renders the empty state when a fresh key is unknown to the server", async () => {
    mockFetch(() =>
      jsonResponse({ error: { code: "not_found", message: "Sync key not found." } }, 404),
    );

    renderSessions();

    expect(await screen.findByText(/No sessions yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an auth error instead of the empty state on a rejected key", async () => {
    const user = userEvent.setup();
    mockFetch(() =>
      jsonResponse(
        { error: { code: "unauthorized", message: "A valid bearer token is required." } },
        401,
      ),
    );

    renderSessions();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /sync key was rejected/i,
    );
    expect(screen.queryByText(/No sessions yet/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change key" }));

    expect(await screen.findByTestId("landing-page")).toBeInTheDocument();
    expect(loadKey()).toBeNull();
  });

  it("reports a decrypt failure but still renders the other sessions", async () => {
    const good = sessionFixture({ title: "Readable session" });
    const goodBlob = await encryptedBlob(good);
    mockFetch(() =>
      jsonResponse({
        blobs: [
          goodBlob,
          { id: "broken", ciphertext: "AAAA", updatedAt: 1_700_000_000_001 },
        ],
      }),
    );

    renderSessions();

    expect(
      await screen.findByRole("heading", { name: "Readable session" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be decrypted/i,
    );
    expect(screen.queryByText(/No sessions yet/i)).not.toBeInTheDocument();
  });

  it("never renders sessions marked incognito", async () => {
    const normal = sessionFixture({ title: "Normal session" });
    const privateSession = sessionFixture({
      id: OLDER_ID,
      title: "Private session",
      incognito: true,
      createdAt: 1_650_000_000_000,
      updatedAt: 1_650_000_000_000,
    });
    const [normalBlob, privateBlob] = await Promise.all([
      encryptedBlob(normal),
      encryptedBlob(privateSession),
    ]);
    mockFetch(() => jsonResponse({ blobs: [privateBlob, normalBlob] }));

    renderSessions();

    expect(await screen.findByText("Normal session")).toBeInTheDocument();
    expect(screen.queryByText("Private session")).not.toBeInTheDocument();
  });

  it("requests confirmation before deleting and treats a 404 as success", async () => {
    const user = userEvent.setup();
    const session = sessionFixture({ title: "Delete me" });
    const blob = await encryptedBlob(session);
    const fetchMock = mockFetch((url, init) => {
      if (init?.method === "DELETE") {
        return jsonResponse(
          { error: { code: "not_found", message: "Session not found." } },
          404,
        );
      }
      return jsonResponse({ blobs: [blob] });
    });

    renderSessions();

    expect(
      await screen.findByRole("heading", { name: "Delete me" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("dialog", {
      name: "Delete this session?",
    });
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Delete session" }),
    ).toHaveFocus();
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE")).toBe(
      false,
    );

    // Escape cancels without touching the server.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE")).toBe(
      false,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      screen.getByRole("button", { name: "Delete session" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Delete me" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      fetchMock.mock.calls.some(
        (call) =>
          call[1]?.method === "DELETE" &&
          String(call[0]).endsWith(`/sessions/${SESSION_ID}`),
      ),
    ).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("exports one session using the standard sessions envelope", async () => {
    const user = userEvent.setup();
    const session = sessionFixture({ title: "Export me" });
    const blob = await encryptedBlob(session);
    mockFetch(() => jsonResponse({ blobs: [blob] }));

    let exported: Blob | undefined;
    let filename = "";
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((value: Blob) => {
        exported = value;
        return "blob:test";
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        filename = this.download;
      },
    );

    renderSessions();

    await screen.findByRole("heading", { name: "Export me" });
    await user.click(screen.getByRole("button", { name: "Export JSON" }));

    await waitFor(() => expect(exported).toBeDefined());
    const parsed = JSON.parse(await (exported as Blob).text());

    expect(parsed).toMatchObject({
      app: "savetabs",
      kind: "sessions",
      version: 1,
      sessions: [{ id: SESSION_ID }],
    });
    expect(typeof parsed.exportedAt).toBe("string");
    expect(Number.isNaN(Date.parse(parsed.exportedAt))).toBe(false);
    expect(filename).toBe(`savetabs-session-${SESSION_ID}.json`);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("copies session tabs as plain URLs", async () => {
    const user = userEvent.setup();
    const session = sessionFixture({ title: "Copy me" });
    const blob = await encryptedBlob(session);
    mockFetch(() => jsonResponse({ blobs: [blob] }));
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(
      undefined,
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderSessions();

    await screen.findByRole("heading", { name: "Copy me" });
    await user.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://example.com/a\nhttps://docs.example.com/b",
      ),
    );
  });

  it("opens every tab of a session in a new browser tab", async () => {
    const user = userEvent.setup();
    const session = sessionFixture({ title: "Restore me" });
    const blob = await encryptedBlob(session);
    mockFetch(() => jsonResponse({ blobs: [blob] }));
    const open = vi
      .spyOn(window, "open")
      .mockImplementation(() => ({ opener: null }) as Window);

    renderSessions();

    await screen.findByRole("heading", { name: "Restore me" });
    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls.map((call) => call[0])).toEqual([
      "https://example.com/a",
      "https://docs.example.com/b",
    ]);
  });

  it("filters sessions by session and tab titles", async () => {
    const user = userEvent.setup();
    const first = sessionFixture({ title: "Morning reading" });
    const second = sessionFixture({
      id: OLDER_ID,
      title: "Evening reading",
      createdAt: 1_650_000_000_000,
      updatedAt: 1_650_000_000_000,
      tabs: [{ url: "https://night.example.com", title: "Night tab" }],
    });
    const [firstBlob, secondBlob] = await Promise.all([
      encryptedBlob(first),
      encryptedBlob(second),
    ]);
    mockFetch(() => jsonResponse({ blobs: [firstBlob, secondBlob] }));

    renderSessions();

    await screen.findByText("Morning reading");
    expect(screen.getByText("Evening reading")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search sessions"), "night");

    expect(screen.queryByText("Morning reading")).not.toBeInTheDocument();
    expect(screen.getByText("Evening reading")).toBeInTheDocument();
  });

  it("applies the stored theme on the sessions route", async () => {
    localStorage.setItem("web-theme", "dark");
    mockFetch(() => jsonResponse({ blobs: [] }));

    render(
      <MemoryRouter initialEntries={["/sessions"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );
  });

  it("has every sessions translation in both languages", () => {
    expect(missingKeys("en", WEB_SESSION_KEYS)).toEqual([]);
    expect(missingKeys("vi", WEB_SESSION_KEYS)).toEqual([]);
  });
});
