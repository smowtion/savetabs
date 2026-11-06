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
  missingKeys,
  parseKey,
  unwrapSyncKey,
  wrapSyncKey,
  type AccountAck,
  type AccountClient,
  type AccountProfile,
  type ChangePasswordInput,
  type ChangePasswordResult,
  type DeleteAccountInput,
  type LoginInput,
  type LoginResult,
} from "@savetabs/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import App from "../App";
import { loadAccountToken, saveAccountToken } from "../lib/account-session";
import { API_BASE } from "../lib/config";
import { loadKey, saveKeyForSession } from "../lib/key-session";
import Account from "./Account";

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
const NEW_TOKEN = "account-token-456";
const STORED_KEY = formatKey(new Uint8Array(16).fill(7));
const SERVER_MESSAGE = "Email or password is incorrect.";
const ACCOUNT: AccountProfile = {
  id: "account-1",
  email: EMAIL,
  emailVerified: false,
  authId: "sync-key-auth-id",
  locale: "en",
};

const ACCOUNT_TRANSLATION_KEYS = [
  "web.account.title",
  "web.account.description",
  "web.account.emailLabel",
  "web.account.verified",
  "web.account.unverified",
  "web.account.resend",
  "web.account.resending",
  "web.account.resendSuccess",
  "web.account.resendFailed",
  "web.account.changePasswordTitle",
  "web.account.changePasswordDescription",
  "web.account.currentPasswordLabel",
  "web.account.newPasswordLabel",
  "web.account.confirmPasswordLabel",
  "web.account.passwordHint",
  "web.account.passwordTooShort",
  "web.account.passwordMismatch",
  "web.account.passwordRequired",
  "web.account.changePasswordSubmit",
  "web.account.changePasswordSubmitting",
  "web.account.passwordChanged",
  "web.account.passwordChangeFailed",
  "web.account.noVault",
  "web.account.recoveryKeyTitle",
  "web.account.recoveryKeyDescription",
  "web.account.passwordLabel",
  "web.account.viewKeySubmit",
  "web.account.viewKeySubmitting",
  "web.account.viewKeyLabel",
  "web.account.viewKeyFailed",
  "web.account.hideKey",
  "web.account.logout",
  "web.account.deleteTitle",
  "web.account.deleteDescription",
  "web.account.deletePasswordLabel",
  "web.account.deleteCloudLabel",
  "web.account.deleteCloudHint",
  "web.account.deleteSubmit",
  "web.account.deleteConfirmTitle",
  "web.account.deleteConfirmMessage",
  "web.account.deleteCloudConfirmMessage",
  "web.account.deleteConfirm",
  "web.account.deleteDeleting",
  "web.account.deleteFailed",
  "web.account.loadFailed",
  "web.account.home",
  "web.account.sessionsLink",
  "web.account.unlockTitle",
  "web.account.unlockDescription",
  "web.account.unlockAccount",
  "web.account.unlockSubmit",
  "web.account.unlockSubmitting",
  "web.account.unlockError",
];

type MeMock = Mock<(token: string) => Promise<AccountProfile>>;
type ResendMock = Mock<(token: string) => Promise<AccountAck>>;
type LoginMock = Mock<(input: LoginInput) => Promise<LoginResult>>;
type ChangePasswordMock = Mock<
  (token: string, input: ChangePasswordInput) => Promise<ChangePasswordResult>
>;
type LogoutMock = Mock<(token: string) => Promise<void>>;
type DeleteAccountMock = Mock<
  (token: string, input: DeleteAccountInput) => Promise<void>
>;

function useClient(
  stubs: {
    me?: MeMock;
    resendVerification?: ResendMock;
    login?: LoginMock;
    changePassword?: ChangePasswordMock;
    logout?: LogoutMock;
    deleteAccount?: DeleteAccountMock;
  } = {},
) {
  const me =
    stubs.me ??
    vi
      .fn<(token: string) => Promise<AccountProfile>>()
      .mockResolvedValue(ACCOUNT);
  const resendVerification =
    stubs.resendVerification ??
    vi
      .fn<(token: string) => Promise<AccountAck>>()
      .mockResolvedValue({ ok: true });
  const login =
    stubs.login ??
    vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockResolvedValue({ token: TOKEN, account: ACCOUNT, vault: null });
  const changePassword =
    stubs.changePassword ??
    vi
      .fn<
        (token: string, input: ChangePasswordInput) => Promise<ChangePasswordResult>
      >()
      .mockResolvedValue({ token: NEW_TOKEN });
  const logout =
    stubs.logout ??
    vi.fn<(token: string) => Promise<void>>().mockResolvedValue(undefined);
  const deleteAccount =
    stubs.deleteAccount ??
    vi
      .fn<(token: string, input: DeleteAccountInput) => Promise<void>>()
      .mockResolvedValue(undefined);

  createAccountClientMock.mockReturnValue({
    me,
    resendVerification,
    login,
    changePassword,
    logout,
    deleteAccount,
  } as unknown as AccountClient);

  return {
    me,
    resendVerification,
    login,
    changePassword,
    logout,
    deleteAccount,
  };
}

type KeyMaterial = {
  salt: Uint8Array;
  masterKey: Uint8Array;
  wrapKey: CryptoKey;
  authHash: string;
};

/** Derive the password material exactly as the page does. */
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

function renderAccount() {
  return render(
    <MemoryRouter initialEntries={["/account"]}>
      <Routes>
        <Route path="/" element={<div data-testid="landing-page" />} />
        <Route path="/login" element={<div data-testid="login-page" />} />
        <Route path="/account" element={<Account />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openDeleteDialog(
  user: ReturnType<typeof userEvent.setup>,
  options: { password?: string; deleteCloudData?: boolean } = {},
): Promise<HTMLElement> {
  await screen.findByText(EMAIL);
  const section = screen.getByRole("region", { name: "Delete account" });
  await user.type(
    within(section).getByLabelText("Your password"),
    options.password ?? PASSWORD,
  );
  if (options.deleteCloudData === true) {
    await user.click(
      within(section).getByLabelText(
        "Also delete the cloud data synced with this account",
      ),
    );
  }
  await user.click(
    within(section).getByRole("button", { name: "Delete account" }),
  );
  return screen.findByRole("dialog", { name: "Delete your account?" });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  createAccountClientMock.mockReset();
  saveAccountToken(TOKEN);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Account page", () => {
  it("serves the account route from the app router and shows the email", async () => {
    useClient();

    render(
      <MemoryRouter initialEntries={["/account"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Your account" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(EMAIL)).toBeInTheDocument();
  });

  it("redirects to sign in when there is no account token", async () => {
    localStorage.clear();
    useClient();

    render(
      <MemoryRouter initialEntries={["/account"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("resends the verification email", async () => {
    const user = userEvent.setup();
    const { resendVerification } = useClient();
    renderAccount();

    const button = await screen.findByRole("button", {
      name: "Resend verification email",
    });
    await user.click(button);

    expect(resendVerification).toHaveBeenCalledWith(TOKEN);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Verification email sent.",
    );
  });

  it("hides the verification banner for a verified email", async () => {
    useClient({
      me: vi
        .fn<(token: string) => Promise<AccountProfile>>()
        .mockResolvedValue({ ...ACCOUNT, emailVerified: true }),
    });
    renderAccount();

    expect(await screen.findByText(EMAIL)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resend verification email" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Your email address is not verified yet."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("changes the password, re-wraps the sync key, and replaces the token", async () => {
    const user = userEvent.setup();
    const oldMaterial = await keyMaterial(PASSWORD);
    const newMaterial = await keyMaterial(NEW_PASSWORD);
    const vault = await buildVault(oldMaterial, STORED_KEY);
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockResolvedValue({ token: TOKEN, account: ACCOUNT, vault });
    const changePassword = vi
      .fn<
        (token: string, input: ChangePasswordInput) => Promise<ChangePasswordResult>
      >()
      .mockResolvedValue({ token: NEW_TOKEN });
    const resendVerification = vi
      .fn<(token: string) => Promise<AccountAck>>()
      .mockResolvedValue({ ok: true });
    useClient({ login, changePassword, resendVerification });
    renderAccount();
    await screen.findByText(EMAIL);

    await user.type(screen.getByLabelText("Current password"), PASSWORD);
    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.type(
      screen.getByLabelText("Confirm new password"),
      NEW_PASSWORD,
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Password changed.",
    );
    expect(login).toHaveBeenCalledWith({
      email: EMAIL,
      authHash: oldMaterial.authHash,
    });

    expect(changePassword).toHaveBeenCalledTimes(1);
    const [tokenArg, input] = changePassword.mock.calls[0];
    expect(tokenArg).toBe(TOKEN);
    expect(input.oldAuthHash).toBe(oldMaterial.authHash);
    expect(input.newAuthHash).toBe(newMaterial.authHash);
    // The salt is derived from the email, so it does not change.
    expect(input.kdfSalt).toBe(encodeSalt(newMaterial.salt));
    expect(input.kdfIterations).toBe(KDF_ITERATIONS);

    // The vault re-wraps the same sync key under the new password.
    const rawKey = await unwrapSyncKey(
      newMaterial.wrapKey,
      input.wrappedKey,
      vault?.authId as string,
    );
    expect(formatKey(rawKey)).toBe(STORED_KEY);
    expect(loadAccountToken()).toBe(NEW_TOKEN);

    // The page keeps working with the replacement token: the old one was
    // revoked by the server.
    await user.click(
      screen.getByRole("button", { name: "Resend verification email" }),
    );
    expect(resendVerification).toHaveBeenCalledWith(NEW_TOKEN);
  });

  it("rejects a new password shorter than 12 characters", async () => {
    const user = userEvent.setup();
    const { login, changePassword } = useClient();
    renderAccount();
    await screen.findByText(EMAIL);

    await user.type(screen.getByLabelText("Current password"), PASSWORD);
    await user.type(screen.getByLabelText("New password"), "short-pass");
    await user.type(screen.getByLabelText("Confirm new password"), "short-pass");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "at least 12 characters",
    );
    expect(login).not.toHaveBeenCalled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("rejects mismatched new passwords", async () => {
    const user = userEvent.setup();
    const { changePassword } = useClient();
    renderAccount();
    await screen.findByText(EMAIL);

    await user.type(screen.getByLabelText("Current password"), PASSWORD);
    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.type(
      screen.getByLabelText("Confirm new password"),
      "another-password-789",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "passwords do not match",
    );
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("keeps one generic error when the current password is rejected", async () => {
    const user = userEvent.setup();
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockRejectedValue(
        new AccountApiError(401, "invalid_credentials", SERVER_MESSAGE),
      );
    const { changePassword } = useClient({ login });
    renderAccount();
    await screen.findByText(EMAIL);

    await user.type(screen.getByLabelText("Current password"), PASSWORD);
    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.type(
      screen.getByLabelText("Confirm new password"),
      NEW_PASSWORD,
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not change your password",
    );
    expect(screen.queryByText(SERVER_MESSAGE)).not.toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
    expect(loadAccountToken()).toBe(TOKEN);
  });

  it("reveals the recovery key only after the password is verified", async () => {
    const user = userEvent.setup();
    const material = await keyMaterial(PASSWORD);
    const vault = await buildVault(material, STORED_KEY);
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockResolvedValue({ token: TOKEN, account: ACCOUNT, vault });
    useClient({ login });
    renderAccount();
    await screen.findByText(EMAIL);

    const section = screen.getByRole("region", { name: "Recovery key" });
    expect(within(section).queryByText(STORED_KEY)).not.toBeInTheDocument();

    await user.type(within(section).getByLabelText("Password"), PASSWORD);
    await user.click(
      within(section).getByRole("button", { name: "View recovery key" }),
    );

    expect(await within(section).findByText(STORED_KEY)).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith({
      email: EMAIL,
      authHash: material.authHash,
    });
    // The key is rendered from memory, never placed in the URL.
    expect(window.location.href).not.toContain(STORED_KEY);

    await user.click(within(section).getByRole("button", { name: "Hide" }));
    expect(within(section).queryByText(STORED_KEY)).not.toBeInTheDocument();
  });

  it("requires a password before revealing the recovery key", async () => {
    const user = userEvent.setup();
    const { login } = useClient();
    renderAccount();
    await screen.findByText(EMAIL);

    const section = screen.getByRole("region", { name: "Recovery key" });
    await user.click(
      within(section).getByRole("button", { name: "View recovery key" }),
    );

    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "Enter your password.",
    );
    expect(login).not.toHaveBeenCalled();
    expect(screen.queryByText(STORED_KEY)).not.toBeInTheDocument();
  });

  it("does not reveal the recovery key when the password is rejected", async () => {
    const user = userEvent.setup();
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockRejectedValue(
        new AccountApiError(401, "invalid_credentials", SERVER_MESSAGE),
      );
    useClient({ login });
    renderAccount();
    await screen.findByText(EMAIL);

    const section = screen.getByRole("region", { name: "Recovery key" });
    await user.type(
      within(section).getByLabelText("Password"),
      "wrong-password-123",
    );
    await user.click(
      within(section).getByRole("button", { name: "View recovery key" }),
    );

    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "We could not show the recovery key",
    );
    expect(screen.queryByText(STORED_KEY)).not.toBeInTheDocument();
  });

  it("signs out, clears the account token, and keeps the sync key", async () => {
    const user = userEvent.setup();
    const { logout } = useClient();
    saveKeyForSession(STORED_KEY);
    renderAccount();
    await screen.findByText(EMAIL);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(logout).toHaveBeenCalledWith(TOKEN);
    expect(loadAccountToken()).toBeNull();
    expect(loadKey()).toBe(STORED_KEY);
    expect(await screen.findByTestId("landing-page")).toBeInTheDocument();
  });

  it("deletes the account after confirmation without touching cloud data", async () => {
    const user = userEvent.setup();
    const material = await keyMaterial(PASSWORD);
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockResolvedValue({ token: TOKEN, account: ACCOUNT, vault: null });
    const deleteAccount = vi
      .fn<(token: string, input: DeleteAccountInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    useClient({ login, deleteAccount });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    saveKeyForSession(STORED_KEY);
    renderAccount();

    const dialog = await openDeleteDialog(user);

    await user.click(
      within(dialog).getByRole("button", { name: "Delete account" }),
    );

    await waitFor(() =>
      expect(deleteAccount).toHaveBeenCalledWith(TOKEN, {
        authHash: material.authHash,
      }),
    );
    expect(login).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loadAccountToken()).toBeNull();
    expect(loadKey()).toBe(STORED_KEY);
    expect(await screen.findByTestId("landing-page")).toBeInTheDocument();
  });

  it("deletes the cloud data with the key-derived credentials when requested", async () => {
    const user = userEvent.setup();
    const material = await keyMaterial(PASSWORD);
    const derived = await deriveKeys(parseKey(STORED_KEY));
    const vault = await buildVault(material, STORED_KEY);
    expect(vault?.authId).toBe(derived.authId);
    const login = vi
      .fn<(input: LoginInput) => Promise<LoginResult>>()
      .mockResolvedValue({ token: TOKEN, account: ACCOUNT, vault });
    const deleteAccount = vi
      .fn<(token: string, input: DeleteAccountInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    useClient({ login, deleteAccount });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    saveKeyForSession(STORED_KEY);
    renderAccount();

    const dialog = await openDeleteDialog(user, { deleteCloudData: true });
    expect(within(dialog).getByText(/cloud data for its sync key/i)).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Delete account" }),
    );

    await waitFor(() =>
      expect(deleteAccount).toHaveBeenCalledWith(TOKEN, {
        authHash: material.authHash,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE}/v1/keys/${derived.authId}`);
    expect(init?.method).toBe("DELETE");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Bearer ${derived.authKey}`,
    );
    // Cloud data is deleted before the account so a failure can be retried.
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteAccount.mock.invocationCallOrder[0],
    );
    expect(loadAccountToken()).toBeNull();
    expect(await screen.findByTestId("landing-page")).toBeInTheDocument();
  });

  it("has every account translation in both languages", () => {
    expect(missingKeys("en", ACCOUNT_TRANSLATION_KEYS)).toEqual([]);
    expect(missingKeys("vi", ACCOUNT_TRANSLATION_KEYS)).toEqual([]);
  });
});
