import {
  AccountApiError,
  missingKeys,
  type AccountClient,
  type VerifyEmailResult,
} from "@savetabs/shared";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import App from "../App";
import { loadKey } from "../lib/key-session";
import Verify from "./Verify";

const { createAccountClientMock } = vi.hoisted(() => ({
  createAccountClientMock: vi.fn(),
}));

vi.mock("../lib/account-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/account-session")>();
  return { ...actual, createAccountClient: createAccountClientMock };
});

const VERIFY_TRANSLATION_KEYS = [
  "web.verify.title",
  "web.verify.checking",
  "web.verify.successTitle",
  "web.verify.success",
  "web.verify.expiredTitle",
  "web.verify.expired",
  "web.verify.errorTitle",
  "web.verify.error",
  "web.verify.back",
];

type VerifyMock = Mock<(token: string) => Promise<VerifyEmailResult>>;

function useClient(verifyEmail?: VerifyMock) {
  const verify =
    verifyEmail ??
    vi
      .fn<(token: string) => Promise<VerifyEmailResult>>()
      .mockResolvedValue({ verified: true });

  createAccountClientMock.mockReturnValue({
    verifyEmail: verify,
  } as unknown as AccountClient);

  return verify;
}

function renderVerify(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/verify" element={<Verify />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  createAccountClientMock.mockReset();
});

describe("Verify page", () => {
  it("shows a verification result from the link token", async () => {
    const verify = useClient();
    renderVerify("/verify?token=abc");

    expect(
      await screen.findByRole(
        "heading",
        { name: "Email verified" },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    expect(verify).toHaveBeenCalledWith("abc");
  });

  it("shows the expired state for a 410 response", async () => {
    const verify = useClient(
      vi
        .fn<(token: string) => Promise<VerifyEmailResult>>()
        .mockRejectedValue(
          new AccountApiError(
            410,
            "invalid_token",
            "The link is invalid or has expired.",
          ),
        ),
    );
    renderVerify("/verify?token=expired");

    expect(
      await screen.findByRole("heading", { name: "Link expired" }),
    ).toBeInTheDocument();
    expect(verify).toHaveBeenCalledWith("expired");
  });

  it("shows a generic error without leaking the server message", async () => {
    useClient(
      vi
        .fn<(token: string) => Promise<VerifyEmailResult>>()
        .mockRejectedValue(
          new AccountApiError(500, "internal_error", "D1_ERROR: secret"),
        ),
    );
    renderVerify("/verify?token=broken");

    expect(
      await screen.findByRole("heading", { name: "Verification failed" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/D1_ERROR/)).not.toBeInTheDocument();
  });

  it("shows the generic error without calling the API when the token is missing", () => {
    const verify = useClient();
    renderVerify("/verify");

    expect(
      screen.getByRole("heading", { name: "Verification failed" }),
    ).toBeInTheDocument();
    expect(verify).not.toHaveBeenCalled();
  });

  it("serves the route without a stored key", async () => {
    useClient();
    render(
      <MemoryRouter initialEntries={["/verify?token=abc"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole(
        "heading",
        { name: "Email verified" },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    expect(loadKey()).toBeNull();
  });
});

describe("Verify translations", () => {
  it("has every verification string in both languages", () => {
    expect(missingKeys("en", VERIFY_TRANSLATION_KEYS)).toEqual([]);
    expect(missingKeys("vi", VERIFY_TRANSLATION_KEYS)).toEqual([]);
  });
});
