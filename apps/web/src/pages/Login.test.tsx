import {
  AccountApiError,
  KDF_ITERATIONS,
  deriveAuthHash,
  deriveKdfSalt,
  deriveKeys,
  deriveMasterKey,
  deriveWrapKey,
  encodeSalt,
  formatKey,
  missingKeys,
  parseKey,
  unwrapSyncKey,
  wrapSyncKey,
  type AccountAck,
  type AccountClient,
  type AccountProfile,
  type LinkKeyInput,
  type LoginInput,
  type LoginResult,
  type RecoverInput,
} from "@savetabs/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import App from "../App";
import { loadAccountToken } from "../lib/account-session";
import {
  KEY_STORAGE_KEY,
  isKeyRemembered,
  loadKey,
} from "../lib/key-session";
import Login from "./Login";

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
const NEW_PASSWORD = "a-new-password-456";
const TOKEN = "account-token-123";
const AUTH_ID = "sync-key-auth-id";
const STORED_KEY = formatKey(new Uint8Array(16).fill(7));
const RECOVERY_KEY = formatKey(new Uint8Array(16).fill(3));
const SERVER_MESSAGE = "Email or password is incorrect.";
const ACCOUNT: AccountProfile = {
  id: "account-1",
  email: EMAIL,
  emailVerified: true,
  authId: AUTH_ID,
  locale: "en",
};

const LOGIN_TRANSLATION_KEYS = [
  "web.login.title",
  "web.login.description",
  "web.login.emailLabel",
  "web.login.emailPlaceholder",
  "web.login.passwordLabel",
  "web.login.rememberLabel",
  "web.login.rememberWarning",
  "web.login.submit",
  "web.login.submitting",
  "web.login.error",
  "web.login.recoveryLink",
  "web.login.createAccount",
  "web.login.back",
];

const RECOVER_TRANSLATION_KEYS = [
  "web.recover.title",
  "web.recover.description",
  "web.recover.emailLabel",
  "web.recover.emailPlaceholder",
  "web.recover.keyLabel",
  "web.recover.keyPlaceholder",
  "web.recover.passwordLabel",
  "web.recover.passwordHint",
  "web.recover.confirmLabel",
  "web.recover.submit",
  "web.recover.submitting",
  "web.recover.passwordTooShort",
  "web.recover.passwordMismatch",
  "web.recover.error",
  "web.recover.cancel",
];

type LoginMock = Mock<(input: LoginInput) => Promise<LoginResult>>;
type LinkKeyMock = Mock<
  (token: string, input: LinkKeyInput) => Promise<AccountAck>
>;
type RecoverMock = Mock<(input: RecoverInput) => Promise<AccountAck>>;

function useClient(
  stubs: {
    login?: LoginMock;
    linkKey?: LinkKeyMock;
    recover?: RecoverMock;
  } = {},
) {
  const login =
    stubs.login ??
    vi.fn<(input: LoginInput) => Promise<LoginResult>>().mockResolvedValue({
      token: TOKEN,
      account: ACCOUNT,
      vault: null,
    });
  const linkKey =
    stubs.linkKey ??
    vi
      .fn<(token: string, input: LinkKeyInput) => Promise<AccountAck>>()
      .mockResolvedValue({ ok: true });
  const recover =
    stubs.recover ??
    vi
      .fn<(input: RecoverInput) => Promise<AccountAck>>()
      .mockResolvedValue({ ok: true });

  createAccountClientMock.mockReturnValue({
    login,
    linkKey,
    recover,
  } as unknown as AccountClient);

  return { login, linkKey, recover };
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/sessions" element={<h1>Saved sessions</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

type KeyMaterial = {
  salt: Uint8Array;
  masterKey: Uint8Array;
  wrapKey: CryptoKey;
  authHash: string;
};

/** Derive the login material exactly as the page does. */
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
  authId: string,
): Promise<LoginResult["vault"]> {
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

async function signIn(
  user: ReturnType<typeof userEvent.setup>,
  email = EMAIL,
  password = PASSWORD,
): Promise<void> {
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

async function openRecovery(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(
    screen.getByRole("button", { name: /use your recovery key/i }),
  );
}

async function fillRecovery(
  user: ReturnType<typeof userEvent.setup>,
  options: { key?: string; password?: string; confirm?: string } = {},
): Promise<void> {
  const password = options.password ?? NEW_PASSWORD;
  await user.type(screen.getByLabelText("Email"), EMAIL);
  await user.type(
    screen.getByLabelText("Recovery key"),
    options.key ?? RECOVERY_KEY,
  );
  await user.type(screen.getByLabelText("New password"), password);
  await user.type(
    screen.getByLabelText("Confirm new password"),
    options.confirm ?? password,
  );
}

async function submitRecovery(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Reset password" }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  createAccountClientMock.mockReset();
});

describe("Login page", () => {
  it("serves the login route from the app router", () => {
    useClient();
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("logs in, unwraps the vault, and stores the key for the session", async () => {
    const user = userEvent.setup();
    const material = await keyMaterial(PASSWORD);
    const vault = await buildVault(material, STORED_KEY, AUTH_ID);
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockResolvedValue({ token: TOKEN, account: ACCOUNT, vault });
    useClient({ login });
    renderLogin();

    await signIn(user, `  ${EMAIL.toUpperCase()}  `);

    expect(
      await screen.findByRole(
        "heading",
        { name: "Saved sessions" },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();

    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith({
      email: EMAIL,
      authHash: material.authHash,
    });
    expect(loadAccountToken()).toBe(TOKEN);
    expect(loadKey()).toBe(STORED_KEY);
    expect(isKeyRemembered()).toBe(false);
    expect(sessionStorage.getItem(KEY_STORAGE_KEY)).toBe(STORED_KEY);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("remembers the key on this device when the option is checked", async () => {
    const user = userEvent.setup();
    const vault = await buildVault(
      await keyMaterial(PASSWORD),
      STORED_KEY,
      AUTH_ID,
    );
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockResolvedValue({ token: TOKEN, account: ACCOUNT, vault });
    useClient({ login });
    renderLogin();

    await user.type(screen.getByLabelText("Email"), EMAIL);
    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.click(screen.getByLabelText("Remember on this device"));
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByRole(
      "heading",
      { name: "Saved sessions" },
      { timeout: 10_000 },
    );

    expect(isKeyRemembered()).toBe(true);
    expect(localStorage.getItem(KEY_STORAGE_KEY)).toBe(STORED_KEY);
  });

  it("links a generated key and requires acknowledging the recovery key", async () => {
    const user = userEvent.setup();
    const material = await keyMaterial(PASSWORD);
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockResolvedValue({ token: TOKEN, account: ACCOUNT, vault: null });
    const { linkKey } = useClient({ login });
    renderLogin();

    await signIn(user);

    const dialog = await screen.findByRole(
      "dialog",
      { name: "Save your recovery key" },
      { timeout: 10_000 },
    );
    const storedKey = loadKey();
    expect(storedKey).toMatch(/^ST-/);
    expect(loadAccountToken()).toBe(TOKEN);

    expect(linkKey).toHaveBeenCalledTimes(1);
    const [linkToken, linkInput] = linkKey.mock.calls[0];
    expect(linkToken).toBe(TOKEN);
    expect(linkInput.authHash).toBe(material.authHash);

    // The linked credentials belong to the key that was stored locally.
    const derived = await deriveKeys(parseKey(storedKey as string));
    expect(linkInput.authId).toBe(derived.authId);
    expect(linkInput.authKey).toBe(derived.authKey);

    // The vault binds to the sync key's authId, not the account record id.
    const rawKey = await unwrapSyncKey(
      material.wrapKey,
      linkInput.wrappedKey,
      derived.authId,
    );
    expect(formatKey(rawKey)).toBe(storedKey);
    expect(within(dialog).getByText(storedKey as string)).toBeInTheDocument();

    // Acknowledging the key is required before the sessions page opens.
    expect(
      screen.queryByRole("heading", { name: "Saved sessions" }),
    ).not.toBeInTheDocument();
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeDisabled();
    await user.click(screen.getByLabelText("I saved it"));
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);

    expect(
      await screen.findByRole("heading", { name: "Saved sessions" }),
    ).toBeInTheDocument();
  });

  it("shows one generic error for rejected credentials", async () => {
    const user = userEvent.setup();
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockRejectedValue(
        new AccountApiError(401, "invalid_credentials", SERVER_MESSAGE),
      );
    const { linkKey } = useClient({ login });
    renderLogin();

    await signIn(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not sign you in",
    );
    expect(screen.queryByText(SERVER_MESSAGE)).not.toBeInTheDocument();
    expect(loadAccountToken()).toBeNull();
    expect(loadKey()).toBeNull();
    expect(linkKey).not.toHaveBeenCalled();
  });
});

describe("Recovery form", () => {
  it("resets the password with the recovery key, then signs in", async () => {
    const user = userEvent.setup();
    const derived = await deriveKeys(parseKey(RECOVERY_KEY));
    const material = await keyMaterial(NEW_PASSWORD);
    const recover = vi
      .fn<(input: RecoverInput) => Promise<AccountAck>>()
      .mockResolvedValue({ ok: true });
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockResolvedValue({
        token: TOKEN,
        account: { ...ACCOUNT, authId: derived.authId },
        vault: {
          wrappedKey: await wrapSyncKey(
            material.wrapKey,
            parseKey(RECOVERY_KEY),
            derived.authId,
          ),
          kdfSalt: encodeSalt(material.salt),
          kdfIterations: KDF_ITERATIONS,
          authId: derived.authId,
        },
      });
    useClient({ recover, login });
    renderLogin();

    await openRecovery(user);
    await fillRecovery(user);
    await submitRecovery(user);

    expect(
      await screen.findByRole(
        "heading",
        { name: "Saved sessions" },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();

    expect(recover).toHaveBeenCalledTimes(1);
    const input = recover.mock.calls[0][0];
    expect(input).toMatchObject({
      email: EMAIL,
      authId: derived.authId,
      authKey: derived.authKey,
      authHash: material.authHash,
      kdfSalt: encodeSalt(material.salt),
      kdfIterations: KDF_ITERATIONS,
    });
    // The vault wraps the same key under the new password, bound to authId.
    const rawKey = await unwrapSyncKey(
      material.wrapKey,
      input.wrappedKey,
      derived.authId,
    );
    expect(formatKey(rawKey)).toBe(RECOVERY_KEY);

    expect(login).toHaveBeenCalledWith({
      email: EMAIL,
      authHash: material.authHash,
    });
    expect(loadAccountToken()).toBe(TOKEN);
    expect(loadKey()).toBe(RECOVERY_KEY);
  });

  it("rejects a new password shorter than 12 characters", async () => {
    const user = userEvent.setup();
    const { recover } = useClient();
    renderLogin();

    await openRecovery(user);
    await fillRecovery(user, { password: "short-pass" });
    await submitRecovery(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "at least 12 characters",
    );
    expect(recover).not.toHaveBeenCalled();
  });

  it("rejects mismatched new passwords", async () => {
    const user = userEvent.setup();
    const { recover } = useClient();
    renderLogin();

    await openRecovery(user);
    await fillRecovery(user, { confirm: "another-password-456" });
    await submitRecovery(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "passwords do not match",
    );
    expect(recover).not.toHaveBeenCalled();
  });

  it("treats a malformed recovery key with a generic error", async () => {
    const user = userEvent.setup();
    const { recover } = useClient();
    renderLogin();

    await openRecovery(user);
    await fillRecovery(user, { key: "not-a-key" });
    await submitRecovery(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not reset your password",
    );
    expect(recover).not.toHaveBeenCalled();
    expect(loadKey()).toBeNull();
  });

  it("keeps recovery API failures generic", async () => {
    const user = userEvent.setup();
    const recover = vi
      .fn<(input: RecoverInput) => Promise<AccountAck>>()
      .mockRejectedValue(
        new AccountApiError(404, "not_found", "Account not found."),
      );
    const { login } = useClient({ recover });
    renderLogin();

    await openRecovery(user);
    await fillRecovery(user);
    await submitRecovery(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not reset your password",
    );
    expect(screen.queryByText(/Account not found/i)).not.toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
    expect(loadAccountToken()).toBeNull();
    expect(loadKey()).toBeNull();
  });
});

describe("Login translations", () => {
  it("has every login and recovery string in both languages", () => {
    const keys = [...LOGIN_TRANSLATION_KEYS, ...RECOVER_TRANSLATION_KEYS];
    expect(missingKeys("en", keys)).toEqual([]);
    expect(missingKeys("vi", keys)).toEqual([]);
  });
});
