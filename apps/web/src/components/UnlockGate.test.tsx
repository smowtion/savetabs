import {
  AccountApiError,
  KDF_ITERATIONS,
  deriveAuthHash,
  deriveKeys,
  deriveKdfSalt,
  deriveMasterKey,
  deriveWrapKey,
  encodeSalt,
  formatKey,
  parseKey,
  wrapSyncKey,
  type AccountClient,
  type AccountProfile,
  type LoginInput,
  type LoginResult,
} from "@savetabs/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import App from "../App";
import { loadAccountToken, saveAccountToken } from "../lib/account-session";
import {
  KEY_STORAGE_KEY,
  isKeyRemembered,
  loadKey,
} from "../lib/key-session";

const { createAccountClientMock } = vi.hoisted(() => ({
  createAccountClientMock: vi.fn(),
}));

vi.mock("../lib/account-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/account-session")>();
  return { ...actual, createAccountClient: createAccountClientMock };
});

const EMAIL = "a@example.com";
const PASSWORD = "a-long-password-123";
const TOKEN = "account-token-123";
const STORED_KEY = formatKey(new Uint8Array(16).fill(7));
const SERVER_MESSAGE = "Email or password is incorrect.";
const ACCOUNT: AccountProfile = {
  id: "account-1",
  email: EMAIL,
  emailVerified: true,
  authId: "sync-key-auth-id",
  locale: "en",
};

type MeMock = Mock<(token: string) => Promise<AccountProfile>>;
type LoginMock = Mock<(input: LoginInput) => Promise<LoginResult>>;

function useClient(stubs: { me?: MeMock; login?: LoginMock } = {}) {
  const me =
    stubs.me ??
    vi
      .fn<(token: string) => Promise<AccountProfile>>()
      .mockResolvedValue(ACCOUNT);
  const login =
    stubs.login ??
    vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockResolvedValue({ token: TOKEN, account: ACCOUNT, vault: null });

  createAccountClientMock.mockReturnValue({
    me,
    login,
  } as unknown as AccountClient);

  return { me, login };
}

type KeyMaterial = {
  salt: Uint8Array;
  masterKey: Uint8Array;
  wrapKey: CryptoKey;
  authHash: string;
};

/** Derive the login material exactly as the unlock gate does. */
async function keyMaterial(password: string): Promise<KeyMaterial> {
  const salt = await deriveKdfSalt(EMAIL);
  const masterKey = await deriveMasterKey(password, salt);
  return {
    salt,
    masterKey,
    wrapKey: await deriveWrapKey(masterKey),
    authHash: await deriveAuthHash(masterKey),
  };
}

async function buildVault(
  material: KeyMaterial,
  rawKey: string,
): Promise<LoginResult["vault"]> {
  const { authId } = await deriveKeys(parseKey(rawKey));
  return {
    wrappedKey: await wrapSyncKey(
      material.wrapKey,
      parseKey(rawKey),
      authId,
    ),
    kdfSalt: encodeSalt(material.salt),
    kdfIterations: KDF_ITERATIONS,
    authId,
  };
}

function stubEmptySessions(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ blobs: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

async function unlock(
  user: ReturnType<typeof userEvent.setup>,
  options: { remember?: boolean; password?: string } = {},
): Promise<void> {
  await screen.findByText(new RegExp(`Signed in as ${EMAIL}`));
  await user.type(
    screen.getByLabelText("Password"),
    options.password ?? PASSWORD,
  );
  if (options.remember === true) {
    await user.click(screen.getByLabelText("Remember on this device"));
  }
  await user.click(screen.getByRole("button", { name: "Unlock" }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  createAccountClientMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Unlock gate", () => {
  it("unlocks a stored session with the password", async () => {
    const user = userEvent.setup();
    const material = await keyMaterial(PASSWORD);
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockResolvedValue({
        token: TOKEN,
        account: ACCOUNT,
        vault: await buildVault(material, STORED_KEY),
      });
    useClient({ login });
    saveAccountToken(TOKEN);
    stubEmptySessions();

    renderApp("/sessions");

    await unlock(user);

    expect(
      await screen.findByRole("heading", { name: "Saved sessions" }),
    ).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith({
      email: EMAIL,
      authHash: material.authHash,
    });
    expect(loadKey()).toBe(STORED_KEY);
    expect(sessionStorage.getItem(KEY_STORAGE_KEY)).toBe(STORED_KEY);
    expect(isKeyRemembered()).toBe(false);
  });

  it("keeps the key on this device when the remember option is checked", async () => {
    const user = userEvent.setup();
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockResolvedValue({
        token: TOKEN,
        account: ACCOUNT,
        vault: await buildVault(await keyMaterial(PASSWORD), STORED_KEY),
      });
    useClient({ login });
    saveAccountToken(TOKEN);
    stubEmptySessions();

    renderApp("/sessions");

    await unlock(user, { remember: true });

    await screen.findByRole("heading", { name: "Saved sessions" });
    expect(isKeyRemembered()).toBe(true);
    expect(localStorage.getItem(KEY_STORAGE_KEY)).toBe(STORED_KEY);
  });

  it("shows the unlock form instead of redirecting when only a token exists", async () => {
    useClient();
    saveAccountToken(TOKEN);

    renderApp("/sessions");

    expect(
      await screen.findByRole("heading", {
        name: "Unlock with your password",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Open your saved tabs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Saved sessions" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a rejected password generic and stays locked", async () => {
    const user = userEvent.setup();
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockRejectedValue(
        new AccountApiError(401, "invalid_credentials", SERVER_MESSAGE),
      );
    useClient({ login });
    saveAccountToken(TOKEN);

    renderApp("/sessions");

    await unlock(user, { password: "wrong-password-123" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not unlock your sessions",
    );
    expect(screen.queryByText(SERVER_MESSAGE)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Saved sessions" }),
    ).not.toBeInTheDocument();
    expect(loadKey()).toBeNull();
    expect(loadAccountToken()).toBe(TOKEN);
  });

  it("reports a profile that cannot be loaded", async () => {
    const me = vi
      .fn<(token: string) => Promise<AccountProfile>>()
      .mockRejectedValue(
        new AccountApiError(401, "unauthorized", "Account token is invalid."),
      );
    useClient({ me });
    saveAccountToken(TOKEN);

    renderApp("/sessions");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not load your account",
    );
    expect(screen.getByRole("button", { name: "Unlock" })).toBeDisabled();
    // The sign-in link gives a way out of a revoked session.
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
