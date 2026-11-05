import { describe, expect, it, vi } from "vitest";

import { AccountApiError, AccountClient } from "./account-client";

const ORIGIN = "https://api.savetabs.test";
const TOKEN = "account-token";
const AUTH_HASH = "ab".repeat(32);

const PROFILE = {
  id: "account-1",
  email: "a@example.com",
  emailVerified: true,
  authId: "auth-id",
  locale: "en" as const,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

/** Client pointed at a deliberately trailing-slash base URL. */
function createClient(fetchImpl: typeof fetch): AccountClient {
  return new AccountClient(`${ORIGIN}///`, fetchImpl);
}

function requestInit(mock: ReturnType<typeof vi.fn<typeof fetch>>, call: number): RequestInit {
  return mock.mock.calls[call]?.[1] ?? {};
}

function headersOf(mock: ReturnType<typeof vi.fn<typeof fetch>>, call: number): Headers {
  return new Headers(requestInit(mock, call).headers);
}

function bodyOf(mock: ReturnType<typeof vi.fn<typeof fetch>>, call: number): unknown {
  return JSON.parse(String(requestInit(mock, call).body));
}

describe("AccountClient", () => {
  it("posts signup and returns the generic acknowledgement", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ok: true }, 202),
    );
    const client = createClient(fetchMock);
    const input = {
      email: "a@example.com",
      authHash: AUTH_HASH,
      kdfSalt: "AAAA",
      kdfIterations: 600000,
      locale: "en" as const,
    };

    await expect(client.signup(input)).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${ORIGIN}/v1/accounts/signup`);
    const init = requestInit(fetchMock, 0);
    expect(init.method).toBe("POST");
    expect(headersOf(fetchMock, 0).get("content-type")).toBe("application/json");
    expect(headersOf(fetchMock, 0).get("authorization")).toBeNull();
    expect(bodyOf(fetchMock, 0)).toEqual(input);
  });

  it("logs in and returns the token, profile and vault", async () => {
    const body = {
      token: TOKEN,
      account: PROFILE,
      vault: {
        wrappedKey: "wrapped",
        kdfSalt: "AAAA",
        kdfIterations: 600000,
        authId: "auth-id",
      },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body));
    const client = createClient(fetchMock);

    await expect(
      client.login({ email: "a@example.com", authHash: AUTH_HASH }),
    ).resolves.toEqual(body);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${ORIGIN}/v1/accounts/login`);
    expect(requestInit(fetchMock, 0).method).toBe("POST");
    expect(bodyOf(fetchMock, 0)).toEqual({
      email: "a@example.com",
      authHash: AUTH_HASH,
    });
  });

  it("fetches the profile with the account token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(PROFILE));
    const client = createClient(fetchMock);

    await expect(client.me(TOKEN)).resolves.toEqual(PROFILE);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${ORIGIN}/v1/accounts/me`);
    expect(requestInit(fetchMock, 0).method).toBe("GET");
    expect(headersOf(fetchMock, 0).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("logs out and resolves void", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(emptyResponse(204));
    const client = createClient(fetchMock);

    await expect(client.logout(TOKEN)).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${ORIGIN}/v1/accounts/logout`);
    expect(requestInit(fetchMock, 0).method).toBe("POST");
    expect(headersOf(fetchMock, 0).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("verifies an email token without account auth", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ verified: true }),
    );
    const client = createClient(fetchMock);

    await expect(client.verifyEmail("verify-token")).resolves.toEqual({
      verified: true,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${ORIGIN}/v1/accounts/verify-email`,
    );
    expect(requestInit(fetchMock, 0).method).toBe("POST");
    expect(bodyOf(fetchMock, 0)).toEqual({ token: "verify-token" });
    expect(headersOf(fetchMock, 0).get("authorization")).toBeNull();
  });

  it("resends the verification email with the account token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ok: true }, 202),
    );
    const client = createClient(fetchMock);

    await expect(client.resendVerification(TOKEN)).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${ORIGIN}/v1/accounts/resend-verification`,
    );
    expect(headersOf(fetchMock, 0).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("links a key with the account token and the key bearer", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ok: true }),
    );
    const client = createClient(fetchMock);
    const input = {
      authId: "auth-id",
      authKey: "key-bearer-secret",
      wrappedKey: "wrapped",
      authHash: AUTH_HASH,
      replace: true,
    };

    await expect(client.linkKey(TOKEN, input)).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${ORIGIN}/v1/accounts/key`);
    expect(requestInit(fetchMock, 0).method).toBe("POST");
    expect(headersOf(fetchMock, 0).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(bodyOf(fetchMock, 0)).toEqual(input);
  });

  it("changes the password and returns a fresh token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ token: "fresh-token" }),
    );
    const client = createClient(fetchMock);
    const input = {
      oldAuthHash: AUTH_HASH,
      newAuthHash: "cd".repeat(32),
      kdfSalt: "BBBB",
      kdfIterations: 600000,
      wrappedKey: "wrapped",
    };

    await expect(client.changePassword(TOKEN, input)).resolves.toEqual({
      token: "fresh-token",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${ORIGIN}/v1/accounts/password`);
    expect(headersOf(fetchMock, 0).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(bodyOf(fetchMock, 0)).toEqual(input);
  });

  it("recovers an account with the key bearer in the body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ok: true }),
    );
    const client = createClient(fetchMock);
    const input = {
      email: "a@example.com",
      authId: "auth-id",
      authKey: "key-bearer-secret",
      authHash: AUTH_HASH,
      kdfSalt: "BBBB",
      kdfIterations: 600000,
      wrappedKey: "wrapped",
    };

    await expect(client.recover(input)).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${ORIGIN}/v1/accounts/recover`);
    expect(requestInit(fetchMock, 0).method).toBe("POST");
    expect(headersOf(fetchMock, 0).get("authorization")).toBeNull();
    expect(bodyOf(fetchMock, 0)).toEqual(input);
  });

  it("requests an unlinked reset link", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ok: true }, 202),
    );
    const client = createClient(fetchMock);

    await expect(
      client.requestUnlinkedReset({ email: "a@example.com", locale: "vi" }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${ORIGIN}/v1/accounts/reset-unlinked`,
    );
    expect(bodyOf(fetchMock, 0)).toEqual({ email: "a@example.com", locale: "vi" });
  });

  it("confirms an unlinked reset with the emailed token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ok: true }),
    );
    const client = createClient(fetchMock);
    const input = {
      token: "reset-token",
      authHash: AUTH_HASH,
      kdfSalt: "CCCC",
      kdfIterations: 600000,
    };

    await expect(client.confirmUnlinkedReset(input)).resolves.toEqual({
      ok: true,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${ORIGIN}/v1/accounts/reset-unlinked/confirm`,
    );
    expect(bodyOf(fetchMock, 0)).toEqual(input);
  });

  it("deletes the account with the password proof and accepts 204", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(emptyResponse(204));
    const client = createClient(fetchMock);

    await expect(
      client.deleteAccount(TOKEN, { authHash: AUTH_HASH }),
    ).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${ORIGIN}/v1/accounts`);
    const init = requestInit(fetchMock, 0);
    expect(init.method).toBe("DELETE");
    expect(headersOf(fetchMock, 0).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(bodyOf(fetchMock, 0)).toEqual({ authHash: AUTH_HASH });
  });

  it("maps the error envelope to AccountApiError", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { error: { code: "invalid_credentials", message: "no" } },
        401,
      ),
    );
    const client = createClient(fetchMock);

    const error = await client
      .login({ email: "a@b.c", authHash: AUTH_HASH })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AccountApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      status: 401,
      code: "invalid_credentials",
      message: "no",
    });
  });

  it("falls back to internal_error when the error body is not JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("boom", { status: 500 }),
    );
    const client = createClient(fetchMock);

    const error = await client.me(TOKEN).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AccountApiError);
    expect(error).toMatchObject({ status: 500, code: "internal_error" });
    expect((error as Error).message).toContain("500");
  });

  it("invokes fetch with the global receiver", async () => {
    // Browsers reject native fetch when called as an object method, so the
    // client must never hand itself to the fetch implementation as `this`.
    let receiver: unknown;
    const fetchMock = vi.fn(function (this: unknown) {
      receiver = this;
      return Promise.resolve(jsonResponse(PROFILE));
    });
    const client = new AccountClient(
      ORIGIN,
      fetchMock as unknown as typeof fetch,
    );

    await client.me(TOKEN);

    expect(receiver).toBe(globalThis);
  });
});
