import {
  createTranslator,
  deriveKeys,
  formatKey,
  generateKey,
  parseKey,
  type AccountProfile,
} from "@savetabs/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXTENSION_ACCOUNT_TOKEN_KEY } from "../lib/account-session";
import {
  SYNC_KEY_REBIND_STORAGE_KEY,
  SYNC_KEY_STORAGE_KEY,
} from "../lib/sync/key-store";
import { syncNow } from "../lib/sync/sync-service";
import { SyncSection, maskKey } from "./SyncSection";

const { clientMock } = vi.hoisted(() => ({
  clientMock: {
    signup: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    linkKey: vi.fn(),
    changePassword: vi.fn(),
  },
}));

vi.mock("@savetabs/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@savetabs/shared")>();
  return {
    ...actual,
    AccountClient: function AccountClientMock() {
      return clientMock;
    },
  };
});

vi.mock("../lib/sync/sync-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/sync/sync-service")>();
  return { ...actual, syncNow: vi.fn() };
});

const t = createTranslator("en");
const syncNowMock = vi.mocked(syncNow);
const EMAIL = "a@example.com";
const PASSWORD = "a-long-password-123";
const TOKEN = "extension-account-token";
const ACCOUNT: AccountProfile = {
  id: "account-1",
  email: EMAIL,
  emailVerified: true,
  authId: "vault-auth-id",
  locale: "en",
};

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

async function readStorage(): Promise<Record<string, unknown>> {
  return (await fakeBrowser.storage.local.get(null)) as Record<string, unknown>;
}

async function storedKey(): Promise<string> {
  const stored = await readStorage();
  const key = stored[SYNC_KEY_STORAGE_KEY];
  if (typeof key !== "string") throw new Error("No key was stored");
  return key;
}

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  syncNowMock.mockResolvedValue({
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    errors: [],
  });
  // Key rotation revokes the old cloud data; the default is a successful 204.
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
  );
});

afterEach(() => {
  cleanup();
  fakeBrowser.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalClipboard === undefined) {
    Reflect.deleteProperty(navigator, "clipboard");
  } else {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  }
  Reflect.deleteProperty(document, "execCommand");
});

describe("SyncSection", () => {
  it("creates a key on first render and shows it masked", async () => {
    render(<SyncSection t={t} />);

    const value = await screen.findByTestId("sync-key-value");
    const key = await storedKey();

    expect(() => parseKey(key)).not.toThrow();
    expect(value).toHaveTextContent(maskKey(key));
    expect(value.textContent).not.toBe(key);
    expect(value.textContent).not.toContain(
      key.split("-").slice(1).join(""),
    );
  });

  it("warns that the key is the only credential and cannot be recovered", async () => {
    render(<SyncSection t={t} />);

    expect(
      await screen.findByText(
        "If you lose this key, your synced data cannot be recovered.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This key is the only credential for your synced data. Anyone with it can read, change, or delete that data.",
      ),
    ).toBeInTheDocument();
  });

  it("reveals and hides the key", async () => {
    render(<SyncSection t={t} />);

    const value = await screen.findByTestId("sync-key-value");
    const key = await storedKey();
    expect(value).toHaveTextContent(maskKey(key));

    await userEvent.click(screen.getByRole("button", { name: "Reveal key" }));

    expect(value).toHaveTextContent(key);
    expect(value.textContent).toBe(key);

    await userEvent.click(screen.getByRole("button", { name: "Hide key" }));

    expect(value.textContent).toBe(maskKey(key));
  });

  it("copies the real key through the clipboard API even while masked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<SyncSection t={t} />);

    await screen.findByTestId("sync-key-value");
    const key = await storedKey();

    await userEvent.click(screen.getByRole("button", { name: "Copy key" }));

    expect(writeText).toHaveBeenCalledWith(key);
    expect(
      screen.getByText("Key copied to the clipboard."),
    ).toBeInTheDocument();
  });

  it("falls back to a temporary textarea when the clipboard API fails", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
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

    render(<SyncSection t={t} />);

    await screen.findByTestId("sync-key-value");
    const key = await storedKey();

    await userEvent.click(screen.getByRole("button", { name: "Copy key" }));

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(selectedValue).toBe(key);
    expect(document.querySelector("textarea")).toBeNull();
    expect(
      screen.getByText("Key copied to the clipboard."),
    ).toBeInTheDocument();
  });

  it("shows an error when both clipboard paths fail", async () => {
    Reflect.deleteProperty(navigator, "clipboard");
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });

    render(<SyncSection t={t} />);

    await screen.findByTestId("sync-key-value");
    await userEvent.click(screen.getByRole("button", { name: "Copy key" }));

    expect(
      await screen.findByText("Could not copy the key."),
    ).toBeInTheDocument();
  });

  it("rejects an invalid imported key without changing storage", async () => {
    render(<SyncSection t={t} />);

    await screen.findByTestId("sync-key-value");
    const key = await storedKey();

    await userEvent.type(
      screen.getByLabelText("Import key"),
      "ST-not-a-real-key",
    );
    await userEvent.click(screen.getByRole("button", { name: "Import key" }));

    expect(
      await screen.findByText("That is not a valid SaveTabs key."),
    ).toBeInTheDocument();
    await expect(storedKey()).resolves.toBe(key);
    expect(
      screen.queryByText("Upload local sessions under this new key?"),
    ).not.toBeInTheDocument();
  });

  it("imports a normalized key and offers uploading local sessions by default", async () => {
    render(<SyncSection t={t} />);

    await screen.findByTestId("sync-key-value");
    const imported = generateKey().toLowerCase();
    const normalized = formatKey(parseKey(imported));

    await userEvent.type(screen.getByLabelText("Import key"), imported);
    await userEvent.click(screen.getByRole("button", { name: "Import key" }));

    expect(
      screen.getByText("Upload local sessions under this new key?"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Upload local sessions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Skip upload" }),
    ).toBeInTheDocument();
    // The decision is recorded only after the user chooses.
    expect(await readStorage()).not.toHaveProperty(
      SYNC_KEY_REBIND_STORAGE_KEY,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Upload local sessions" }),
    );

    expect(
      await screen.findByText(
        "Key imported. Local sessions will be uploaded under it.",
      ),
    ).toBeInTheDocument();
    await expect(storedKey()).resolves.toBe(normalized);
    const stored = await readStorage();
    expect(stored[SYNC_KEY_REBIND_STORAGE_KEY]).toBe("upload");
    expect(screen.getByTestId("sync-key-value").textContent).toBe(
      maskKey(normalized),
    );
    // Choosing "upload" starts syncing immediately instead of waiting for the
    // retry alarm or the next startup.
    await expect(syncNowMock).toHaveBeenCalledTimes(1);
  });

  it("imports the key but skips local upload when the user declines", async () => {
    render(<SyncSection t={t} />);

    await screen.findByTestId("sync-key-value");
    const imported = generateKey();

    await userEvent.type(screen.getByLabelText("Import key"), imported);
    await userEvent.click(screen.getByRole("button", { name: "Import key" }));
    await userEvent.click(screen.getByRole("button", { name: "Skip upload" }));

    expect(
      await screen.findByText(
        "Key imported. Local sessions will not be uploaded.",
      ),
    ).toBeInTheDocument();
    await expect(storedKey()).resolves.toBe(imported);
    const stored = await readStorage();
    expect(stored[SYNC_KEY_REBIND_STORAGE_KEY]).toBe("skip");
    expect(syncNowMock).not.toHaveBeenCalled();
  });

  it("requires typing ROTATE before rotating and stores a fresh key", async () => {
    render(<SyncSection t={t} />);

    await screen.findByTestId("sync-key-value");
    const previous = await storedKey();

    await userEvent.click(screen.getByRole("button", { name: "Rotate key" }));

    expect(
      screen.getByText(
        "Rotating creates a new key and tries to delete the cloud data encrypted with the old key. Local sessions are uploaded under the new key.",
      ),
    ).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Create new key" });
    expect(confirm).toBeDisabled();

    const confirmInput = screen.getByLabelText("Type ROTATE to confirm");
    await userEvent.type(confirmInput, "rotate");
    expect(confirm).toBeDisabled();

    await userEvent.clear(confirmInput);
    await userEvent.type(confirmInput, "ROTATE");
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);

    expect(
      await screen.findByText(
        "New key created. Old cloud data was deleted. Local sessions will be uploaded under the new key.",
      ),
    ).toBeInTheDocument();
    const rotated = await storedKey();
    expect(rotated).not.toBe(previous);
    expect(() => parseKey(rotated)).not.toThrow();
    const stored = await readStorage();
    expect(stored[SYNC_KEY_REBIND_STORAGE_KEY]).toBe("upload");
    expect(screen.getByTestId("sync-key-value").textContent).toBe(
      maskKey(rotated),
    );
    // Rotation also triggers the upload promised by the rebind decision.
    await expect(syncNowMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the new key when revoking the old cloud data fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<SyncSection t={t} />);

    await screen.findByTestId("sync-key-value");
    const previous = await storedKey();

    await userEvent.click(screen.getByRole("button", { name: "Rotate key" }));
    await userEvent.type(
      screen.getByLabelText("Type ROTATE to confirm"),
      "ROTATE",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create new key" }));

    expect(
      await screen.findByText(
        "New key created, but the old cloud data could not be deleted. Local sessions will be uploaded under the new key.",
      ),
    ).toBeInTheDocument();
    const rotated = await storedKey();
    expect(rotated).not.toBe(previous);
    const stored = await readStorage();
    expect(stored[SYNC_KEY_REBIND_STORAGE_KEY]).toBe("upload");
    // The failure is logged without the key material.
    expect(consoleSpy).toHaveBeenCalled();
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(rotated);
    expect(syncNowMock).toHaveBeenCalledTimes(1);
  });

  it("updates the displayed key when another context changes storage", async () => {
    render(<SyncSection t={t} />);

    await screen.findByTestId("sync-key-value");
    const otherKey = generateKey();

    await fakeBrowser.storage.local.set({ [SYNC_KEY_STORAGE_KEY]: otherKey });

    await waitFor(() =>
      expect(screen.getByTestId("sync-key-value").textContent).toBe(
        maskKey(otherKey),
      ),
    );
  });

  it("keeps the current key when rotation is cancelled", async () => {
    render(<SyncSection t={t} />);

    await screen.findByTestId("sync-key-value");
    const previous = await storedKey();

    await userEvent.click(screen.getByRole("button", { name: "Rotate key" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByLabelText("Type ROTATE to confirm"),
    ).not.toBeInTheDocument();
    await expect(storedKey()).resolves.toBe(previous);
    await waitFor(() =>
      expect(screen.getByTestId("sync-key-value").textContent).toBe(
        maskKey(previous),
      ),
    );
  });
});

describe("SyncSection with a signed-in account", () => {
  beforeEach(async () => {
    await fakeBrowser.storage.local.set({
      [EXTENSION_ACCOUNT_TOKEN_KEY]: TOKEN,
    });
    clientMock.me.mockResolvedValue(ACCOUNT);
    clientMock.linkKey.mockResolvedValue({ ok: true });
  });

  it("re-links the account before rotating and deleting old data", async () => {
    const order: string[] = [];
    clientMock.linkKey.mockImplementation(async () => {
      order.push("relink");
      return { ok: true };
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      order.push("delete-old-data");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SyncSection t={t} />);
    await screen.findByTestId("sync-key-value");
    const previous = await storedKey();

    await userEvent.click(screen.getByRole("button", { name: "Rotate key" }));
    await userEvent.type(
      screen.getByLabelText("Type ROTATE to confirm"),
      "ROTATE",
    );
    await userEvent.type(
      await screen.findByLabelText("Account password"),
      PASSWORD,
    );
    await userEvent.click(screen.getByRole("button", { name: "Create new key" }));

    expect(
      await screen.findByText(
        "New key created. Old cloud data was deleted. Local sessions will be uploaded under the new key.",
        {},
        { timeout: 20_000 },
      ),
    ).toBeInTheDocument();
    expect(order).toEqual(["relink", "delete-old-data"]);

    const rotated = await storedKey();
    expect(rotated).not.toBe(previous);
    const derived = await deriveKeys(parseKey(rotated));
    const [tokenArg, body] = clientMock.linkKey.mock.calls[0];
    expect(tokenArg).toBe(TOKEN);
    expect(body).toMatchObject({
      authId: derived.authId,
      replace: true,
    });
  }, 40_000);

  it("requires the account password before rotating", async () => {
    render(<SyncSection t={t} />);
    await screen.findByTestId("sync-key-value");
    const previous = await storedKey();

    await userEvent.click(screen.getByRole("button", { name: "Rotate key" }));
    await userEvent.type(
      screen.getByLabelText("Type ROTATE to confirm"),
      "ROTATE",
    );
    await screen.findByLabelText("Account password");
    await userEvent.click(screen.getByRole("button", { name: "Create new key" }));

    expect(
      await screen.findByText(
        "Enter your account password to change the sync key.",
      ),
    ).toBeInTheDocument();
    await expect(storedKey()).resolves.toBe(previous);
    expect(clientMock.linkKey).not.toHaveBeenCalled();
  });

  it("aborts an import when the account re-link fails", async () => {
    clientMock.linkKey.mockRejectedValue(new Error("link rejected"));

    render(<SyncSection t={t} />);
    await screen.findByTestId("sync-key-value");
    const previous = await storedKey();

    await userEvent.type(
      screen.getByLabelText("Import key"),
      generateKey(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Import key" }));
    await userEvent.type(
      await screen.findByLabelText("Account password"),
      PASSWORD,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Upload local sessions" }),
    );

    expect(
      await screen.findByText(
        "Could not update the account key. Your sync key was not changed.",
        {},
        { timeout: 20_000 },
      ),
    ).toBeInTheDocument();
    await expect(storedKey()).resolves.toBe(previous);
    expect(clientMock.linkKey).toHaveBeenCalledTimes(1);
    expect(clientMock.linkKey.mock.calls[0][1]).toMatchObject({
      replace: true,
    });
  }, 40_000);
});
