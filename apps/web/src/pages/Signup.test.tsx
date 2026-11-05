import {
  AccountApiError,
  KDF_ITERATIONS,
  decodeSalt,
  deriveKeys,
  deriveMasterKey,
  deriveWrapKey,
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
  type SignupInput,
} from "@savetabs/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { loadAccountToken } from "../lib/account-session";
import { loadKey, saveKeyForSession } from "../lib/key-session";
import Signup from "./Signup";

const { createAccountClientMock } = vi.hoisted(() => ({
  createAccountClientMock: vi.fn(),
}));

vi.mock("../lib/account-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/account-session")>();
  return { ...actual, createAccountClient: createAccountClientMock };
});

/** A syntactically valid key: ST- prefix plus 26 Crockford symbols. */
const VALID_KEY = "ST-00000-00000-00000-00000-00000-0";
const PASSWORD = "a-long-password-123";
const TOKEN = "account-token-123";
const ACCOUNT: AccountProfile = {
  id: "account-1",
  email: "a@example.com",
  emailVerified: false,
  authId: null,
  locale: "en",
};

const SIGNUP_TRANSLATION_KEYS = [
  "web.signup.title",
  "web.signup.description",
  "web.signup.emailLabel",
  "web.signup.emailPlaceholder",
  "web.signup.passwordLabel",
  "web.signup.passwordHint",
  "web.signup.confirmLabel",
  "web.signup.submit",
  "web.signup.submitting",
  "web.signup.passwordTooShort",
  "web.signup.passwordMismatch",
  "web.signup.error",
  "web.signup.recoveryTitle",
  "web.signup.recoveryMessage",
  "web.signup.recoveryKeyLabel",
  "web.signup.recoveryConfirm",
  "web.signup.continue",
  "web.signup.back",
];

type SignupMock = Mock<(input: SignupInput) => Promise<AccountAck>>;
type LoginMock = Mock<(input: LoginInput) => Promise<LoginResult>>;
type LinkKeyMock = Mock<
  (token: string, input: LinkKeyInput) => Promise<AccountAck>
>;

function useClient(
  stubs: { signup?: SignupMock; login?: LoginMock; linkKey?: LinkKeyMock } = {},
) {
  const signup =
    stubs.signup ??
    vi
      .fn<(input: SignupInput) => Promise<AccountAck>>()
      .mockResolvedValue({ ok: true });
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

  createAccountClientMock.mockReturnValue({
    signup,
    login,
    linkKey,
  } as unknown as AccountClient);

  return { signup, login, linkKey };
}

function renderSignup() {
  return render(
    <MemoryRouter initialEntries={["/signup"]}>
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/sessions" element={<div data-testid="sessions-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  options: { password?: string; confirm?: string } = {},
): Promise<void> {
  const password = options.password ?? PASSWORD;
  const confirm = options.confirm ?? password;
  await user.type(screen.getByLabelText("Email"), "a@example.com");
  await user.type(screen.getByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirm);
}

async function submit(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

function findRecoveryDialog() {
  return screen.findByRole(
    "dialog",
    { name: "Save your recovery key" },
    { timeout: 10_000 },
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  createAccountClientMock.mockReset();
});

describe("Signup page", () => {
  it("signs up, links the generated device key, and stores a token", async () => {
    const user = userEvent.setup();
    const { signup, login, linkKey } = useClient();
    renderSignup();

    await fillForm(user);
    await submit(user);

    const dialog = await findRecoveryDialog();
    expect(screen.getByText(/recovery key/i)).toBeInTheDocument();
    expect(loadAccountToken()).toBe(TOKEN);

    const storedKey = loadKey();
    expect(storedKey).toMatch(/^ST-/);

    const signupInput = signup.mock.calls[0][0];
    expect(signupInput).toMatchObject({
      email: "a@example.com",
      kdfIterations: KDF_ITERATIONS,
      locale: "en",
    });
    expect(signupInput.authHash).toMatch(/^[0-9a-f]{64}$/);
    expect(decodeSalt(signupInput.kdfSalt)).toHaveLength(16);

    expect(login).toHaveBeenCalledWith({
      email: "a@example.com",
      authHash: signupInput.authHash,
    });

    expect(linkKey).toHaveBeenCalledTimes(1);
    const [linkToken, linkInput] = linkKey.mock.calls[0];
    expect(linkToken).toBe(TOKEN);
    expect(linkInput.authHash).toBe(signupInput.authHash);

    // The linked credentials belong to the key that was stored locally.
    const derived = await deriveKeys(parseKey(storedKey as string));
    expect(linkInput.authId).toBe(derived.authId);
    expect(linkInput.authKey).toBe(derived.authKey);

    // The vault wraps that same key under the password-derived wrap key.
    const masterKey = await deriveMasterKey(
      PASSWORD,
      decodeSalt(signupInput.kdfSalt),
    );
    const wrapKey = await deriveWrapKey(masterKey);
    const rawKey = await unwrapSyncKey(
      wrapKey,
      linkInput.wrappedKey,
      ACCOUNT.id,
    );
    expect(formatKey(rawKey)).toBe(storedKey);

    expect(within(dialog).getByText(storedKey as string)).toBeInTheDocument();
  });

  it("wraps the key already stored on the device instead of generating one", async () => {
    saveKeyForSession(VALID_KEY);
    const user = userEvent.setup();
    const { linkKey } = useClient();
    renderSignup();

    await fillForm(user);
    await submit(user);

    const dialog = await findRecoveryDialog();
    expect(loadKey()).toBe(VALID_KEY);

    const [, linkInput] = linkKey.mock.calls[0];
    const derived = await deriveKeys(parseKey(VALID_KEY));
    expect(linkInput.authId).toBe(derived.authId);
    expect(linkInput.authKey).toBe(derived.authKey);
    expect(within(dialog).getByText(VALID_KEY)).toBeInTheDocument();
  });

  it("navigates to the sessions page only after the recovery key is confirmed", async () => {
    const user = userEvent.setup();
    useClient();
    renderSignup();

    await fillForm(user);
    await submit(user);
    await findRecoveryDialog();

    expect(screen.queryByTestId("sessions-page")).not.toBeInTheDocument();

    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeDisabled();

    await user.click(screen.getByLabelText("I saved it"));
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);

    expect(await screen.findByTestId("sessions-page")).toBeInTheDocument();
    expect(loadAccountToken()).toBe(TOKEN);
  });

  it("adopts a vault returned by login instead of linking a new key", async () => {
    const user = userEvent.setup();
    const vaultKey = formatKey(new Uint8Array(16).fill(9));
    let signupInput: SignupInput | undefined;

    const signup = vi.fn(async (input: SignupInput): Promise<AccountAck> => {
      signupInput = input;
      return { ok: true };
    });
    const login = vi.fn(async (): Promise<LoginResult> => {
      const masterKey = await deriveMasterKey(
        PASSWORD,
        decodeSalt((signupInput as SignupInput).kdfSalt),
      );
      const wrapKey = await deriveWrapKey(masterKey);
      return {
        token: TOKEN,
        account: ACCOUNT,
        vault: {
          wrappedKey: await wrapSyncKey(
            wrapKey,
            parseKey(vaultKey),
            ACCOUNT.id,
          ),
          kdfSalt: (signupInput as SignupInput).kdfSalt,
          kdfIterations: KDF_ITERATIONS,
          authId: "existing-auth-id",
        },
      };
    });
    const linkKey = vi.fn();
    useClient({
      signup: signup as unknown as SignupMock,
      login: login as unknown as LoginMock,
      linkKey: linkKey as unknown as LinkKeyMock,
    });
    renderSignup();

    await fillForm(user);
    await submit(user);

    const dialog = await findRecoveryDialog();
    expect(loadKey()).toBe(vaultKey);
    expect(linkKey).not.toHaveBeenCalled();
    expect(within(dialog).getByText(vaultKey)).toBeInTheDocument();
  });

  it("shows a generic error for account API failures without revealing existence", async () => {
    const user = userEvent.setup();
    const signup = vi
      .fn<(input: SignupInput) => Promise<AccountAck>>()
      .mockRejectedValue(
        new AccountApiError(
          409,
          "invalid_credentials",
          "That email is already registered.",
        ),
      );
    const { login, linkKey } = useClient({ signup });
    renderSignup();

    await fillForm(user);
    await submit(user);

    expect(
      await screen.findByRole("alert", {}, { timeout: 10_000 }),
    ).toHaveTextContent("We could not create your account");
    expect(screen.queryByText(/already registered/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(loadAccountToken()).toBeNull();
    expect(login).not.toHaveBeenCalled();
    expect(linkKey).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 12 characters", async () => {
    const user = userEvent.setup();
    const { signup } = useClient();
    renderSignup();

    await fillForm(user, { password: "short-pass" });
    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "at least 12 characters",
    );
    expect(signup).not.toHaveBeenCalled();
    expect(loadAccountToken()).toBeNull();
  });

  it("rejects a mismatched confirmation", async () => {
    const user = userEvent.setup();
    const { signup } = useClient();
    renderSignup();

    await fillForm(user, { confirm: "another-password-456" });
    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "passwords do not match",
    );
    expect(signup).not.toHaveBeenCalled();
  });

  it("has every signup translation in both languages", () => {
    expect(missingKeys("en", SIGNUP_TRANSLATION_KEYS)).toEqual([]);
    expect(missingKeys("vi", SIGNUP_TRANSLATION_KEYS)).toEqual([]);
  });
});
