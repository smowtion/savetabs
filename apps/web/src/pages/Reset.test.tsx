/**
 * Emailed reset page for accounts without a linked vault.
 *
 * The account client is mocked at the class boundary; the KDF derivation is
 * the real implementation, so the test asserts the same proof and salt the
 * page sends in production.
 */

import {
  AccountApiError,
  KDF_ITERATIONS,
  deriveAuthHash,
  deriveKdfSalt,
  deriveMasterKey,
  encodeSalt,
  missingKeys,
  type AccountAck,
  type AccountClient,
  type ConfirmUnlinkedResetInput,
} from "@savetabs/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import Reset from "./Reset";

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
const TOKEN = "reset-token-123";

const RESET_TRANSLATION_KEYS = [
  "web.reset.description",
  "web.reset.error",
  "web.reset.invalidTokenTitle",
  "web.reset.invalidToken",
  "web.reset.successTitle",
  "web.reset.success",
  "web.reset.login",
  "web.recover.title",
  "web.recover.emailLabel",
  "web.recover.emailPlaceholder",
  "web.recover.passwordLabel",
  "web.recover.passwordHint",
  "web.recover.confirmLabel",
  "web.recover.submit",
  "web.recover.submitting",
  "web.recover.passwordTooShort",
  "web.recover.passwordMismatch",
  "web.recover.cancel",
];

type ConfirmMock = Mock<
  (input: ConfirmUnlinkedResetInput) => Promise<AccountAck>
>;

function useClient(stub?: ConfirmMock) {
  const confirmUnlinkedReset =
    stub ??
    vi
      .fn<(input: ConfirmUnlinkedResetInput) => Promise<AccountAck>>()
      .mockResolvedValue({ ok: true });

  createAccountClientMock.mockReturnValue({
    confirmUnlinkedReset,
  } as unknown as AccountClient);

  return { confirmUnlinkedReset };
}

function renderReset(search = `?token=${TOKEN}`) {
  return render(
    <MemoryRouter initialEntries={[`/reset${search}`]}>
      <Routes>
        <Route path="/reset" element={<Reset />} />
        <Route path="/login" element={<div data-testid="login-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  options: { email?: string; password?: string; confirm?: string } = {},
): Promise<void> {
  const password = options.password ?? PASSWORD;
  await user.type(screen.getByLabelText("Email"), options.email ?? EMAIL);
  await user.type(screen.getByLabelText("New password"), password);
  await user.type(
    screen.getByLabelText("Confirm new password"),
    options.confirm ?? password,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  createAccountClientMock.mockReset();
});

describe("Reset page", () => {
  it("shows an invalid-link state without a token", () => {
    renderReset("");

    expect(
      screen.getByRole("heading", { name: "Reset link unavailable" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("derives the new proof from the email and confirms the reset token", async () => {
    const user = userEvent.setup();
    const { confirmUnlinkedReset } = useClient();
    renderReset();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(
      await screen.findByRole("heading", { name: "Password reset" }),
    ).toBeInTheDocument();
    expect(confirmUnlinkedReset).toHaveBeenCalledTimes(1);

    const salt = await deriveKdfSalt(EMAIL);
    const masterKey = await deriveMasterKey(PASSWORD, salt);
    expect(confirmUnlinkedReset.mock.calls[0][0]).toEqual({
      token: TOKEN,
      authHash: await deriveAuthHash(masterKey),
      kdfSalt: encodeSalt(salt),
      kdfIterations: KDF_ITERATIONS,
    });
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("normalizes the email before deriving the salt", async () => {
    const user = userEvent.setup();
    const { confirmUnlinkedReset } = useClient();
    renderReset();

    await fillForm(user, { email: `  ${EMAIL.toUpperCase()}  ` });
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    await screen.findByRole("heading", { name: "Password reset" });
    expect(confirmUnlinkedReset.mock.calls[0][0].kdfSalt).toBe(
      encodeSalt(await deriveKdfSalt(EMAIL)),
    );
  });

  it("rejects a short or mismatched password before calling the API", async () => {
    const user = userEvent.setup();
    const { confirmUnlinkedReset } = useClient();
    renderReset();

    await fillForm(user, { password: "short" });
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "at least 12 characters",
    );

    const passwordInput = screen.getByLabelText("New password");
    await user.clear(passwordInput);
    await user.type(passwordInput, PASSWORD);
    const confirmInput = screen.getByLabelText("Confirm new password");
    await user.clear(confirmInput);
    await user.type(confirmInput, "another-password-456");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "passwords do not match",
    );
    expect(confirmUnlinkedReset).not.toHaveBeenCalled();
  });

  it("shows a generic error for an expired or rejected token", async () => {
    const user = userEvent.setup();
    const confirmUnlinkedReset = vi
      .fn<(input: ConfirmUnlinkedResetInput) => Promise<AccountAck>>()
      .mockRejectedValue(
        new AccountApiError(410, "invalid_token", "The link has expired."),
      );
    useClient(confirmUnlinkedReset);
    renderReset();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not reset your password",
    );
    expect(
      screen.queryByRole("heading", { name: "Password reset" }),
    ).not.toBeInTheDocument();
  });

  it("has every reset translation in both languages", () => {
    expect(missingKeys("en", RESET_TRANSLATION_KEYS)).toEqual([]);
    expect(missingKeys("vi", RESET_TRANSLATION_KEYS)).toEqual([]);
  });
});
