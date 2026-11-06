/**
 * HTTP client for the SaveTabs account API.
 *
 * The account API is separate from the sync API: it authenticates with an
 * opaque account token (not the sync key), and its only key material is the
 * already-encrypted vault. The client is deliberately dumb — callers derive
 * the password proof and wrap the sync key before calling it, and a non-2xx
 * response always becomes a typed `AccountApiError`.
 *
 * Account tokens are passed per call rather than held in the client, so one
 * instance can serve the signed-out and signed-in states and tests never leak
 * a token between calls.
 *
 * Runs in the extension, the web app and anywhere `fetch` exists.
 */

import type { Lang } from "../i18n";

/** Public account fields returned by `me` and by login. */
export type AccountProfile = {
  id: string;
  email: string;
  emailVerified: boolean;
  authId: string | null;
  locale: Lang;
};

/** The sync key encrypted under the password-derived wrapping key. */
export type AccountVault = {
  wrappedKey: string;
  kdfSalt: string;
  kdfIterations: number;
  authId: string;
};

/** Successful login: the bearer token plus the account and optional vault. */
export type LoginResult = {
  token: string;
  account: AccountProfile;
  vault: AccountVault | null;
};

/** The generic acknowledgement used where the server reveals no account data. */
export type AccountAck = { ok: true };

/** Result of consuming an email verification token. */
export type VerifyEmailResult = { verified: true };

/** Password change rotates every token, so the caller gets the fresh one. */
export type ChangePasswordResult = { token: string };

export type SignupInput = {
  email: string;
  authHash: string;
  kdfSalt: string;
  kdfIterations: number;
  locale: Lang;
};

export type LoginInput = {
  email: string;
  authHash: string;
};

export type LinkKeyInput = {
  authId: string;
  /** Key-derived bearer proving possession of the sync key. */
  authKey: string;
  wrappedKey: string;
  /** Current password proof; required when replacing an existing link. */
  authHash: string;
  /** Allow repointing an account that already has a different vault. */
  replace?: boolean;
};

export type ChangePasswordInput = {
  oldAuthHash: string;
  newAuthHash: string;
  kdfSalt: string;
  kdfIterations: number;
  wrappedKey: string;
};

export type RecoverInput = {
  email: string;
  authId: string;
  authKey: string;
  authHash: string;
  kdfSalt: string;
  kdfIterations: number;
  wrappedKey: string;
};

export type RequestUnlinkedResetInput = {
  email: string;
  locale: Lang;
};

export type ConfirmUnlinkedResetInput = {
  token: string;
  /**
   * The address typed on the reset page. The server rejects a token issued for
   * a different account, so a typo cannot store a proof under the wrong salt.
   */
  email: string;
  authHash: string;
  kdfSalt: string;
  kdfIterations: number;
};

export type DeleteAccountInput = {
  authHash: string;
};

/** A non-2xx account API response with the server's stable error code. */
export class AccountApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AccountApiError";
  }
}

type ErrorEnvelope = {
  error?: { code?: unknown; message?: unknown };
};

export class AccountClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    // Deployments frequently pass an origin with a trailing slash; normalize
    // once so every path below is built the same way.
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /** Create an account (or trigger the duplicate-email notice). */
  signup(input: SignupInput): Promise<AccountAck> {
    return this.request<AccountAck>("/signup", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Exchange the password proof for a token, profile and (maybe) vault. */
  login(input: LoginInput): Promise<LoginResult> {
    return this.request<LoginResult>("/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Revoke the current account token. */
  async logout(token: string): Promise<void> {
    await this.request<unknown>("/logout", { method: "POST" }, token);
  }

  /** Current profile, verification state and linked sync key id. */
  me(token: string): Promise<AccountProfile> {
    return this.request<AccountProfile>("/me", { method: "GET" }, token);
  }

  /** Consume the token from a verification email. */
  verifyEmail(token: string): Promise<VerifyEmailResult> {
    return this.request<VerifyEmailResult>("/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  /** Ask for a fresh verification email; rate limited server-side. */
  resendVerification(token: string): Promise<AccountAck> {
    return this.request<AccountAck>(
      "/resend-verification",
      { method: "POST" },
      token,
    );
  }

  /**
   * Register or re-point the sync key. The sync key bearer travels in the
   * body; the account token authenticates the caller.
   */
  linkKey(token: string, input: LinkKeyInput): Promise<AccountAck> {
    return this.request<AccountAck>(
      "/key",
      { method: "POST", body: JSON.stringify(input) },
      token,
    );
  }

  /** Change the password and get the replacement token. */
  changePassword(
    token: string,
    input: ChangePasswordInput,
  ): Promise<ChangePasswordResult> {
    return this.request<ChangePasswordResult>(
      "/password",
      { method: "POST", body: JSON.stringify(input) },
      token,
    );
  }

  /**
   * Reset a password with the recovery key. The key bearer lives in the body
   * because the account token is derived from the new password.
   */
  recover(input: RecoverInput): Promise<AccountAck> {
    return this.request<AccountAck>("/recover", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Email a reset link for an account that has no vault. */
  requestUnlinkedReset(
    input: RequestUnlinkedResetInput,
  ): Promise<AccountAck> {
    return this.request<AccountAck>("/reset-unlinked", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Set a new proof and salt from the emailed reset token. */
  confirmUnlinkedReset(
    input: ConfirmUnlinkedResetInput,
  ): Promise<AccountAck> {
    return this.request<AccountAck>("/reset-unlinked/confirm", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Delete the account after proving the password. Cloud data stays. */
  async deleteAccount(token: string, input: DeleteAccountInput): Promise<void> {
    await this.request<unknown>(
      "",
      { method: "DELETE", body: JSON.stringify(input) },
      token,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    token?: string,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (token !== undefined) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const url = `${this.baseUrl}/v1/accounts${path}`;
    // Native fetch is a Window/Worker method and rejects other receivers with
    // "Illegal invocation"; calling it as `this.fetchImpl(...)` would pass the
    // client instance. Pin the receiver to the global scope instead.
    const response = await this.fetchImpl.call(globalThis, url, {
      ...init,
      headers,
    });

    if (!response.ok) throw await this.toError(response);
    if (response.status === 204) return undefined as T;

    const text = await response.text();
    if (text.length === 0) return undefined as T;
    return JSON.parse(text) as T;
  }

  /** Build a typed error, using the API envelope when the body is valid JSON. */
  private async toError(response: Response): Promise<AccountApiError> {
    let code = "internal_error";
    let message = `Account request failed with HTTP ${response.status}`;

    try {
      const body = (await response.json()) as ErrorEnvelope;
      if (typeof body.error?.code === "string") {
        code = body.error.code;
      }
      if (
        typeof body.error?.message === "string" &&
        body.error.message.length > 0
      ) {
        message = body.error.message;
      }
    } catch {
      // Non-JSON error bodies keep the fallback code and message.
    }

    return new AccountApiError(response.status, code, message);
  }
}
