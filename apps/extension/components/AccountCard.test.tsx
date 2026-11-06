/**
 * AccountCard behavior: signed-out form, sign-in, sign-up, sign-out and the
 * recovery-key dialog.
 *
 * The account HTTP client is mocked at the class boundary; the KDF, vault
 * wrapping and key storage are the real implementations, so these tests
 * exercise the same derivations the card runs in production.
 */

import { webcrypto } from "node:crypto";

import {
  KDF_ITERATIONS,
  createTranslator,
  deriveAuthHash,
  deriveKdfSalt,
  deriveKeys,
  deriveMasterKey,
  deriveWrapKey,
  encodeSalt,
  formatKey,
  parseKey,
  wrapSyncKey,
  type AccountProfile,
  type LoginResult,
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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EXTENSION_ACCOUNT_TOKEN_KEY } from "../lib/account-session";
import { SESSIONS_DB_NAME, closeSessionsDb } from "../lib/sessions-db";
import { addSession } from "../lib/sessions-repo";
import {
  SYNC_KEY_REBIND_STORAGE_KEY,
  getKey,
  setKey,
} from "../lib/sync/key-store";
import { AccountCard } from "./AccountCard";

// jsdom ships a Crypto object without SubtleCrypto; the real crypto primitives
// are the ones under test, so fall back to Node's WebCrypto implementation.
if (typeof globalThis.crypto?.subtle === "undefined") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}

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

const t = createTranslator("en");
const EMAIL = "a@example.com";
const PASSWORD = "a-long-password-123";
const NEW_PASSWORD = "another-long-password-456";
const TOKEN = "extension-account-token";
const NEW_TOKEN = "replacement-account-token";
const AUTH_ID = "vault-auth-id";
const ACCOUNT_KEY = formatKey(new Uint8Array(16).fill(7));
const DEVICE_KEY = formatKey(new Uint8Array(16).fill(9));
const ACCOUNT: AccountProfile = {
  id: "account-1",
  email: EMAIL,
  emailVerified: true,
  authId: AUTH_ID,
  locale: "en",
};

type KeyMaterial = {
  salt: Uint8Array;
  masterKey: Uint8Array;
  wrapKey: CryptoKey;
  authHash: string;
};

let material: KeyMaterial;

beforeAll(async () => {
  const salt = await deriveKdfSalt(EMAIL);
  const masterKey = await deriveMasterKey(PASSWORD, salt);
  material = {
    salt,
    masterKey,
    wrapKey: await deriveWrapKey(masterKey),
    authHash: await deriveAuthHash(masterKey),
  };
}, 30_000);

function deleteSessionsDatabase(): Promise<void> {
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
  await closeSessionsDb();
  await deleteSessionsDatabase();
  for (const mock of Object.values(clientMock)) mock.mockReset();
  clientMock.signup.mockResolvedValue({ ok: true });
  clientMock.logout.mockResolvedValue(undefined);
});

afterEach(async () => {
  cleanup();
  fakeBrowser.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await closeSessionsDb();
  await deleteSessionsDatabase();
});

function renderCard(): void {
  render(<AccountCard t={t} />);
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  email = "A@Example.com",
  password = PASSWORD,
): Promise<void> {
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
}

/** A login response whose vault wraps `rawKey` exactly as signup would. */
async function loginResult(
  rawKey: string | null,
  account: AccountProfile = ACCOUNT,
): Promise<LoginResult> {
  return {
    token: TOKEN,
    account,
    vault:
      rawKey === null
        ? null
        : {
            wrappedKey: await wrapSyncKey(
              material.wrapKey,
              parseKey(rawKey),
              AUTH_ID,
            ),
            kdfSalt: encodeSalt(material.salt),
            kdfIterations: KDF_ITERATIONS,
            authId: AUTH_ID,
          },
  };
}

async function storedToken(): Promise<unknown> {
  const stored = await fakeBrowser.storage.local.get(
    EXTENSION_ACCOUNT_TOKEN_KEY,
  );
  return stored[EXTENSION_ACCOUNT_TOKEN_KEY];
}

describe("AccountCard", () => {
  it("signs in and keeps the local sync key on sign-out", async () => {
    await setKey(DEVICE_KEY, "skip");
    clientMock.login.mockResolvedValue(await loginResult(ACCOUNT_KEY));

    const user = userEvent.setup();
    renderCard();
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Sign out" },
        { timeout: 15_000 },
      ),
    );

    expect(await getKey()).toBe(ACCOUNT_KEY);
  });

  it("unwraps the vault, stores the token and uploads under the rebind", async () => {
    clientMock.login.mockResolvedValue(await loginResult(ACCOUNT_KEY));

    const user = userEvent.setup();
    renderCard();
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole(
      "button",
      { name: "Sign out" },
      { timeout: 15_000 },
    );

    expect(await getKey()).toBe(ACCOUNT_KEY);
    await expect(storedToken()).resolves.toBe(TOKEN);
    expect(clientMock.login).toHaveBeenCalledWith({
      email: EMAIL,
      authHash: material.authHash,
    });
    const rebind = await fakeBrowser.storage.local.get(
      SYNC_KEY_REBIND_STORAGE_KEY,
    );
    expect(rebind[SYNC_KEY_REBIND_STORAGE_KEY]).toBe("upload");
  });

  it("signs out by removing only the account token", async () => {
    clientMock.login.mockResolvedValue(await loginResult(ACCOUNT_KEY));

    const user = userEvent.setup();
    renderCard();
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Sign out" },
        { timeout: 15_000 },
      ),
    );

    expect(clientMock.logout).toHaveBeenCalledWith(TOKEN);
    await expect(storedToken()).resolves.toBeUndefined();
    expect(await getKey()).toBe(ACCOUNT_KEY);
    await expect(
      screen.findByLabelText("Email"),
    ).resolves.toBeInTheDocument();
  });

  it("signs out even when the logout request fails", async () => {
    clientMock.login.mockResolvedValue(await loginResult(ACCOUNT_KEY));
    clientMock.logout.mockRejectedValue(new Error("offline"));

    const user = userEvent.setup();
    renderCard();
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Sign out" },
        { timeout: 15_000 },
      ),
    );

    await expect(storedToken()).resolves.toBeUndefined();
    expect(await getKey()).toBe(ACCOUNT_KEY);
  });

  it("shows the recovery key dialog when the account had no vault", async () => {
    await setKey(DEVICE_KEY, "skip");
    clientMock.login.mockResolvedValue(await loginResult(null));
    clientMock.linkKey.mockResolvedValue({ ok: true });

    const user = userEvent.setup();
    renderCard();
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const dialog = await screen.findByRole(
      "dialog",
      {},
      { timeout: 15_000 },
    );
    expect(within(dialog).getByText(DEVICE_KEY)).toBeInTheDocument();

    const continueButton = within(dialog).getByRole("button", {
      name: "Continue",
    });
    expect(continueButton).toBeDisabled();

    await user.click(within(dialog).getByLabelText("I saved it"));
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const derived = await deriveKeys(parseKey(DEVICE_KEY));
    expect(clientMock.linkKey).toHaveBeenCalledTimes(1);
    const [tokenArg, body] = clientMock.linkKey.mock.calls[0];
    expect(tokenArg).toBe(TOKEN);
    expect(body).toMatchObject({
      authId: derived.authId,
      authKey: derived.authKey,
      authHash: material.authHash,
    });
    expect(typeof body.wrappedKey).toBe("string");
    expect(await getKey()).toBe(DEVICE_KEY);
    await expect(storedToken()).resolves.toBe(TOKEN);
  }, 30_000);

  it("creates an account and then signs in with the same credentials", async () => {
    clientMock.login.mockResolvedValue(await loginResult(null));
    clientMock.linkKey.mockResolvedValue({ ok: true });

    const user = userEvent.setup();
    renderCard();
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await screen.findByRole("dialog", {}, { timeout: 30_000 });

    expect(clientMock.signup).toHaveBeenCalledWith({
      email: EMAIL,
      authHash: material.authHash,
      kdfSalt: encodeSalt(material.salt),
      kdfIterations: KDF_ITERATIONS,
      locale: "en",
    });
    expect(clientMock.login).toHaveBeenCalledWith({
      email: EMAIL,
      authHash: material.authHash,
    });
    await expect(storedToken()).resolves.toBe(TOKEN);
  }, 30_000);

  it("rejects a short password before creating an account", async () => {
    const user = userEvent.setup();
    renderCard();
    await fillForm(user, EMAIL, "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      screen.getByRole("alert"),
    ).toHaveTextContent("Use a password with at least 12 characters.");
    expect(clientMock.signup).not.toHaveBeenCalled();
  });

  it("loads a stored session and shows the verification badge", async () => {
    await fakeBrowser.storage.local.set({
      [EXTENSION_ACCOUNT_TOKEN_KEY]: TOKEN,
    });
    clientMock.me.mockResolvedValue(ACCOUNT);

    renderCard();

    await screen.findByRole(
      "button",
      { name: "Sign out" },
      { timeout: 15_000 },
    );
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(clientMock.me).toHaveBeenCalledWith(TOKEN);
  });

  it("lets the user continue with a key instead", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Use a key instead" }));
    expect(screen.queryByLabelText("Email")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Use an account" }));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("asks before uploading local sessions when adopting a different vault", async () => {
    await setKey(DEVICE_KEY, "skip");
    await addSession({
      id: "local-1",
      createdAt: 1,
      updatedAt: 1,
      source: "window",
      tabs: [],
    });
    clientMock.login.mockResolvedValue(await loginResult(ACCOUNT_KEY));
    const confirmPrompt = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmPrompt);

    const user = userEvent.setup();
    renderCard();
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole(
      "button",
      { name: "Sign out" },
      { timeout: 15_000 },
    );

    expect(confirmPrompt).toHaveBeenCalledWith(
      "Upload these sessions to this account?",
    );
    expect(await getKey()).toBe(ACCOUNT_KEY);
    const rebind = await fakeBrowser.storage.local.get(
      SYNC_KEY_REBIND_STORAGE_KEY,
    );
    expect(rebind[SYNC_KEY_REBIND_STORAGE_KEY]).toBe("upload");
  }, 30_000);

  it("changes the password and stores the replacement token", async () => {
    await fakeBrowser.storage.local.set({
      [EXTENSION_ACCOUNT_TOKEN_KEY]: TOKEN,
    });
    clientMock.me.mockResolvedValue(ACCOUNT);
    clientMock.login.mockResolvedValue(await loginResult(ACCOUNT_KEY));
    clientMock.changePassword.mockResolvedValue({ token: NEW_TOKEN });

    const user = userEvent.setup();
    renderCard();
    await screen.findByRole(
      "button",
      { name: "Change password" },
      { timeout: 15_000 },
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    await user.type(screen.getByLabelText("Current password"), PASSWORD);
    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(
      await screen.findByText(
        "Password changed. Other sessions were signed out.",
        {},
        { timeout: 20_000 },
      ),
    ).toBeInTheDocument();
    expect(clientMock.changePassword).toHaveBeenCalledTimes(1);
    const [tokenArg, input] = clientMock.changePassword.mock.calls[0];
    expect(tokenArg).toBe(TOKEN);
    expect(input.oldAuthHash).toBe(material.authHash);
    expect(typeof input.wrappedKey).toBe("string");
    await expect(storedToken()).resolves.toBe(NEW_TOKEN);
  }, 40_000);
});
