import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { toBase64Url } from "@savetabs/shared/base64url";
import app from "../src/index";
import type { Env } from "../src/env";
import { sha256Hex } from "../src/auth";
import { hashToken, normalizeEmail } from "../src/accounts/tokens";

const BASE_URL = "https://savetabs.test";
const CLIENT_AUTH_HASH = "ab".repeat(32);
const OTHER_AUTH_HASH = "cd".repeat(32);
const KDF_SALT = toBase64Url(new Uint8Array(16));
const OTHER_KDF_SALT = toBase64Url(new Uint8Array(16).fill(7));
const KDF_ITERATIONS = 600_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_TTL_MS = 30 * DAY_MS;

interface ErrorBody {
  error: { code: string; message: string };
}

interface Profile {
  id: string;
  email: string;
  emailVerified: boolean;
  authId: string | null;
  locale: string;
}

interface LoginBody {
  token: string;
  account: Profile;
  vault: {
    wrappedKey: string;
    kdfSalt: string;
    kdfIterations: number;
    authId: string;
  } | null;
}

interface AccountRowRead {
  id: string;
  email: string;
  auth_hash: string;
  kdf_salt: string;
  kdf_iterations: number;
  wrapped_key: string | null;
  auth_id: string | null;
  locale: string;
  email_verified_at: number | null;
}

interface VerificationRowRead {
  token_hash: string;
  account_id: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  purpose: string;
}

interface TokenRowRead {
  token_hash: string;
  account_id: string;
  created_at: number;
  expires_at: number;
  last_used_at: number;
}

interface SentEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface SignupOverrides {
  email?: string;
  authHash?: string;
  kdfSalt?: string;
  kdfIterations?: number;
  locale?: string;
}

function signupBody(overrides: SignupOverrides = {}): Record<string, unknown> {
  return {
    email: overrides.email ?? "new@example.com",
    authHash: overrides.authHash ?? CLIENT_AUTH_HASH,
    kdfSalt: overrides.kdfSalt ?? KDF_SALT,
    kdfIterations: overrides.kdfIterations ?? KDF_ITERATIONS,
    locale: overrides.locale ?? "en",
  };
}

function post(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function postRaw(path: string, body: string): Promise<Response> {
  return SELF.fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function seedAccount(options: {
  email: string;
  authHash?: string;
  kdfSalt?: string;
  kdfIterations?: number;
  wrappedKey?: string | null;
  authId?: string | null;
  locale?: string;
  emailVerifiedAt?: number | null;
}): Promise<{ id: string; email: string }> {
  const id = crypto.randomUUID();
  const email = normalizeEmail(options.email);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO accounts
       (id, email, auth_hash, kdf_salt, kdf_iterations, wrapped_key, auth_id,
        locale, email_verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      email,
      await sha256Hex(options.authHash ?? CLIENT_AUTH_HASH),
      options.kdfSalt ?? KDF_SALT,
      options.kdfIterations ?? KDF_ITERATIONS,
      options.wrappedKey ?? null,
      options.authId ?? null,
      options.locale ?? "en",
      options.emailVerifiedAt ?? null,
      now,
      now,
    )
    .run();
  return { id, email };
}

async function seedToken(
  accountId: string,
  token: string,
  options: { expiresAt?: number } = {},
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO account_tokens
       (token_hash, account_id, created_at, expires_at, last_used_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      await hashToken(token),
      accountId,
      now,
      options.expiresAt ?? now + TOKEN_TTL_MS,
      now,
    )
    .run();
}

function readAccount(email: string): Promise<AccountRowRead | null> {
  return env.DB.prepare(
    `SELECT id, email, auth_hash, kdf_salt, kdf_iterations, wrapped_key,
            auth_id, locale, email_verified_at
       FROM accounts WHERE email = ?`,
  )
    .bind(normalizeEmail(email))
    .first<AccountRowRead>();
}

async function readVerifications(
  accountId: string,
): Promise<VerificationRowRead[]> {
  const { results } = await env.DB.prepare(
    `SELECT token_hash, account_id, created_at, expires_at, used_at, purpose
       FROM email_verifications WHERE account_id = ?`,
  )
    .bind(accountId)
    .all<VerificationRowRead>();
  return results;
}

async function readTokens(accountId: string): Promise<TokenRowRead[]> {
  const { results } = await env.DB.prepare(
    `SELECT token_hash, account_id, created_at, expires_at, last_used_at
       FROM account_tokens WHERE account_id = ?`,
  )
    .bind(accountId)
    .all<TokenRowRead>();
  return results;
}

async function loginToken(email: string): Promise<string> {
  const response = await post("/v1/accounts/login", {
    email,
    authHash: CLIENT_AUTH_HASH,
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as LoginBody).token;
}

function meStatus(token: string): Promise<Response> {
  return SELF.fetch(`${BASE_URL}/v1/accounts/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Seed one verification row without going through signup. */
async function seedVerification(
  accountId: string,
  token: string,
  options: {
    expiresAt?: number;
    usedAt?: number | null;
    purpose?: "verify" | "reset";
  } = {},
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO email_verifications
       (token_hash, account_id, created_at, expires_at, used_at, purpose)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      await hashToken(token),
      accountId,
      now,
      options.expiresAt ?? now + DAY_MS,
      options.usedAt ?? null,
      options.purpose ?? "verify",
    )
    .run();
}

/** Pull the plaintext token out of a verification email. */
function verificationTokenFrom(email: SentEmail): string {
  const match = /\/verify\?token=([A-Za-z0-9_-]+)/.exec(email.text);
  expect(match).not.toBeNull();
  return match![1]!;
}

/**
 * Sign up with email delivery enabled and read the raw token back out of the
 * link. Signup is the only point where the plaintext token exists.
 */
async function latestVerificationToken(
  email = `verification-${crypto.randomUUID()}@example.com`,
): Promise<string> {
  const sent: SentEmail[] = [];
  await captureEmails(sent, async () => {
    const response = await app.request(
      `${BASE_URL}/v1/accounts/signup`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signupBody({ email })),
      },
      resendEnv(),
    );
    expect(response.status).toBe(202);
  });

  expect(sent).toHaveLength(1);
  return verificationTokenFrom(sent[0]!);
}

/** Dispatch through the app with Resend enabled so sends can be captured. */
async function appPost(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return await app.request(
    `${BASE_URL}${path}`,
    { method: "POST", headers, body: JSON.stringify(body) },
    resendEnv(),
  );
}

/** Env copy with Resend enabled so the signup routes attempt a send. */
function resendEnv(): Env {
  return {
    DB: env.DB,
    RELEASES: env.RELEASES,
    WEB_ORIGIN: env.WEB_ORIGIN,
    GLOBAL_DAILY_REQUESTS: env.GLOBAL_DAILY_REQUESTS,
    GLOBAL_MAX_KEYS: env.GLOBAL_MAX_KEYS,
    RESEND_API_KEY: "re_test",
    RESEND_FROM: "SaveTabs <noreply@azcom.dev>",
  };
}

/** Capture outbound Resend calls while `run` executes. */
async function captureEmails(
  sent: SentEmail[],
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as SentEmail);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("POST /v1/accounts/signup", () => {
  it("creates an account and returns the same body for a duplicate email", async () => {
    const first = await post("/v1/accounts/signup", signupBody({
      email: "New@Example.com ",
    }));
    expect(first.status).toBe(202);
    const firstBody = await first.json();
    expect(firstBody).toEqual({ ok: true });

    const second = await post(
      "/v1/accounts/signup",
      signupBody({
        email: "New@Example.com ",
        authHash: OTHER_AUTH_HASH,
        kdfSalt: OTHER_KDF_SALT,
        kdfIterations: 100_000,
        locale: "vi",
      }),
    );
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual(firstBody);

    const account = await readAccount("new@example.com");
    expect(account).not.toBeNull();
    expect(account?.email).toBe("new@example.com");
    expect(account?.auth_hash).toBe(await sha256Hex(CLIENT_AUTH_HASH));
    expect(account?.kdf_salt).toBe(KDF_SALT);
    expect(account?.kdf_iterations).toBe(KDF_ITERATIONS);
    expect(account?.wrapped_key).toBeNull();
    expect(account?.auth_id).toBeNull();
    expect(account?.email_verified_at).toBeNull();
    expect(account?.locale).toBe("en");

    const verifications = await readVerifications(account!.id);
    expect(verifications).toHaveLength(1);
    expect(verifications[0]?.purpose).toBe("verify");
    expect(verifications[0]?.used_at).toBeNull();
    expect(verifications[0]?.created_at).toBeGreaterThan(0);
    expect(
      verifications[0]!.expires_at - verifications[0]!.created_at,
    ).toBe(DAY_MS);
  });

  it("rejects invalid fields and malformed JSON without creating an account", async () => {
    const email = "invalid@example.com";
    const base = signupBody({ email });
    const invalidBodies: unknown[] = [
      { ...base, authHash: "AB".repeat(32) },
      { ...base, authHash: CLIENT_AUTH_HASH.slice(1) },
      { ...base, authHash: 42 },
      { ...base, kdfSalt: "AAAA" },
      { ...base, kdfSalt: "!!!!!!!!!!!!!!!!!!!!!!" },
      { ...base, kdfSalt: 42 },
      { ...base, kdfIterations: 99_999 },
      { ...base, kdfIterations: 2_000_001 },
      { ...base, kdfIterations: 100_000.5 },
      { ...base, kdfIterations: "600000" },
      { ...base, locale: 42 },
      { ...base, email: 42 },
      [],
      null,
    ];

    for (const invalid of invalidBodies) {
      const response = await post("/v1/accounts/signup", invalid);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "invalid_request",
      );
    }

    const malformed = await postRaw("/v1/accounts/signup", "{ not json");
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as ErrorBody).error.code).toBe(
      "invalid_request",
    );

    expect(await readAccount(email)).toBeNull();

    // Both iteration bounds are inclusive.
    for (const iterations of [100_000, 2_000_000]) {
      const accepted = await post(
        "/v1/accounts/signup",
        signupBody({
          email: `bounds-${iterations}@example.com`,
          kdfIterations: iterations,
        }),
      );
      expect(accepted.status).toBe(202);
    }
  });

  it("emails the verification link to the normalized address", async () => {
    const sent: SentEmail[] = [];
    await captureEmails(sent, async () => {
      const response = await app.request(
        `${BASE_URL}/v1/accounts/signup`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            signupBody({ email: "Mail@Example.com ", locale: "vi" }),
          ),
        },
        resendEnv(),
      );
      expect(response.status).toBe(202);
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("mail@example.com");
    expect(sent[0]?.subject.length).toBeGreaterThan(0);
    expect(sent[0]?.html).toContain(`${env.WEB_ORIGIN}/verify?token=`);
    expect(sent[0]?.text).toContain(`${env.WEB_ORIGIN}/verify?token=`);

    const account = await readAccount("mail@example.com");
    expect(account?.locale).toBe("vi");
  });

  it("sends a generic notice instead of a verification link for an existing email", async () => {
    await post("/v1/accounts/signup", signupBody({ email: "dupe@example.com" }));

    const sent: SentEmail[] = [];
    await captureEmails(sent, async () => {
      const response = await app.request(
        `${BASE_URL}/v1/accounts/signup`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(signupBody({ email: "Dupe@Example.com " })),
        },
        resendEnv(),
      );
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ ok: true });
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("dupe@example.com");
    expect(sent[0]?.html).toContain(`${env.WEB_ORIGIN}/login`);
    expect(sent[0]?.html).not.toContain("/verify?token=");

    const account = await readAccount("dupe@example.com");
    expect(await readVerifications(account!.id)).toHaveLength(1);
  });
});

describe("POST /v1/accounts/login", () => {
  it("returns a token and a null vault before a key is linked", async () => {
    await post(
      "/v1/accounts/signup",
      signupBody({ email: "NoVault@Example.com ", locale: "vi" }),
    );

    const response = await post("/v1/accounts/login", {
      email: "novault@example.com",
      authHash: CLIENT_AUTH_HASH,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as LoginBody;
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.vault).toBeNull();
    expect(body.account).toMatchObject({
      email: "novault@example.com",
      emailVerified: false,
      authId: null,
      locale: "vi",
    });

    const account = await readAccount("novault@example.com");
    const tokens = await readTokens(account!.id);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.token_hash).toBe(await hashToken(body.token));
    expect(tokens[0]?.created_at).toBe(tokens[0]?.last_used_at);
    expect(tokens[0]!.expires_at - tokens[0]!.created_at).toBe(TOKEN_TTL_MS);

    // The bearer itself is never stored.
    const leaked = await env.DB.prepare(
      "SELECT token_hash FROM account_tokens WHERE token_hash = ?",
    )
      .bind(body.token)
      .first();
    expect(leaked).toBeNull();
  });

  it("returns the vault and profile once a key is linked", async () => {
    const account = await seedAccount({
      email: "vault@example.com",
      wrappedKey: "wrapped-key-1",
      authId: "auth-id-1",
      emailVerifiedAt: Date.now() - DAY_MS,
    });

    const response = await post("/v1/accounts/login", {
      email: "VAULT@example.com",
      authHash: CLIENT_AUTH_HASH,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as LoginBody;
    expect(body.account).toEqual({
      id: account.id,
      email: "vault@example.com",
      emailVerified: true,
      authId: "auth-id-1",
      locale: "en",
    });
    expect(body.vault).toEqual({
      wrappedKey: "wrapped-key-1",
      kdfSalt: KDF_SALT,
      kdfIterations: KDF_ITERATIONS,
      authId: "auth-id-1",
    });
  });

  it("does not distinguish unknown emails from wrong proofs", async () => {
    await seedAccount({ email: "known@example.com" });

    const wrong = await post("/v1/accounts/login", {
      email: "known@example.com",
      authHash: OTHER_AUTH_HASH,
    });
    const unknown = await post("/v1/accounts/login", {
      email: "nobody@example.com",
      authHash: OTHER_AUTH_HASH,
    });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const wrongBody = await wrong.json();
    expect(wrongBody).toEqual({
      error: { code: "invalid_credentials", message: expect.any(String) },
    });
    expect(await unknown.json()).toEqual(wrongBody);

    const known = await readAccount("known@example.com");
    expect(await readTokens(known!.id)).toHaveLength(0);
  });

  it("rejects malformed bodies with the validation envelope", async () => {
    const invalidBodies: unknown[] = [
      {},
      { email: "a@b.c" },
      { authHash: CLIENT_AUTH_HASH },
      { email: 42, authHash: CLIENT_AUTH_HASH },
      { email: "a@b.c", authHash: 42 },
      [],
    ];

    for (const invalid of invalidBodies) {
      const response = await post("/v1/accounts/login", invalid);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "invalid_request",
      );
    }

    const malformed = await postRaw("/v1/accounts/login", "{");
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as ErrorBody).error.code).toBe(
      "invalid_request",
    );
  });
});

describe("GET /v1/accounts/me", () => {
  it("returns the profile without salts or key material", async () => {
    const account = await seedAccount({
      email: "profile@example.com",
      wrappedKey: "wrapped-key-2",
      authId: "auth-id-2",
      locale: "vi",
      emailVerifiedAt: Date.now(),
    });
    const token = await loginToken("profile@example.com");

    const response = await meStatus(token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Profile;
    expect(body).toEqual({
      id: account.id,
      email: "profile@example.com",
      emailVerified: true,
      authId: "auth-id-2",
      locale: "vi",
    });
    expect(Object.keys(body).sort()).toEqual([
      "authId",
      "email",
      "emailVerified",
      "id",
      "locale",
    ]);
  });

  it("rejects missing, unknown and expired tokens", async () => {
    const account = await seedAccount({ email: "expired@example.com" });
    await seedToken(account.id, "expired-token", {
      expiresAt: Date.now() - 1,
    });

    const missing = await SELF.fetch(`${BASE_URL}/v1/accounts/me`);
    const unknown = await SELF.fetch(`${BASE_URL}/v1/accounts/me`, {
      headers: { Authorization: "Bearer nope" },
    });
    const expired = await meStatus("expired-token");

    for (const response of [missing, unknown, expired]) {
      expect(response.status).toBe(401);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "unauthorized",
      );
    }
  });
});

describe("POST /v1/accounts/logout", () => {
  it("revokes only the current token", async () => {
    await seedAccount({ email: "logout@example.com" });
    const first = await loginToken("logout@example.com");
    const second = await loginToken("logout@example.com");

    const response = await SELF.fetch(`${BASE_URL}/v1/accounts/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${first}` },
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");

    expect((await meStatus(first)).status).toBe(401);
    expect((await meStatus(second)).status).toBe(200);

    const again = await SELF.fetch(`${BASE_URL}/v1/accounts/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${first}` },
    });
    expect(again.status).toBe(401);

    const missing = await SELF.fetch(`${BASE_URL}/v1/accounts/logout`, {
      method: "POST",
    });
    expect(missing.status).toBe(401);
  });
});

describe("POST /v1/accounts/verify-email", () => {
  it("verifies a token once", async () => {
    const email = "verify-once@example.com";
    const token = await latestVerificationToken(email);

    const first = await post("/v1/accounts/verify-email", { token });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ verified: true });

    const account = await readAccount(email);
    expect(account?.email_verified_at).toBeGreaterThan(0);
    const verifications = await readVerifications(account!.id);
    expect(verifications).toHaveLength(1);
    expect(verifications[0]?.purpose).toBe("verify");
    expect(verifications[0]?.used_at).toBeGreaterThan(0);

    const second = await post("/v1/accounts/verify-email", { token });
    expect(second.status).toBe(410);
    expect(((await second.json()) as ErrorBody).error.code).toBe(
      "invalid_token",
    );
  });

  it("rejects unknown, expired and wrong-purpose tokens", async () => {
    const account = await seedAccount({ email: "bad-tokens@example.com" });
    const now = Date.now();
    await seedVerification(account.id, "expired-token", {
      expiresAt: now - 1,
    });
    await seedVerification(account.id, "used-token", { usedAt: now - DAY_MS });
    await seedVerification(account.id, "reset-token", { purpose: "reset" });

    for (const token of [
      "unknown-token",
      "expired-token",
      "used-token",
      "reset-token",
    ]) {
      const response = await post("/v1/accounts/verify-email", { token });
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({
        error: { code: "invalid_token", message: expect.any(String) },
      });
    }

    expect(
      (await readAccount("bad-tokens@example.com"))?.email_verified_at,
    ).toBeNull();
  });

  it("rejects malformed bodies", async () => {
    for (const invalid of [{}, { token: 42 }, { token: null }, [], null]) {
      const response = await post("/v1/accounts/verify-email", invalid);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "invalid_request",
      );
    }

    const malformed = await postRaw("/v1/accounts/verify-email", "{");
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as ErrorBody).error.code).toBe(
      "invalid_request",
    );
  });
});

describe("POST /v1/accounts/resend-verification", () => {
  it("requires a signed-in account", async () => {
    const missing = await post("/v1/accounts/resend-verification", {});
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as ErrorBody).error.code).toBe(
      "unauthorized",
    );

    const unknown = await post(
      "/v1/accounts/resend-verification",
      {},
      "not-a-token",
    );
    expect(unknown.status).toBe(401);

    const account = await seedAccount({ email: "resend-expired@example.com" });
    await seedToken(account.id, "expired-account-token", {
      expiresAt: Date.now() - 1,
    });
    const expired = await post(
      "/v1/accounts/resend-verification",
      {},
      "expired-account-token",
    );
    expect(expired.status).toBe(401);
  });

  it("issues a fresh 24-hour token and emails the link", async () => {
    const account = await seedAccount({
      email: "resend@example.com",
      locale: "vi",
    });
    const session = await loginToken("resend@example.com");

    const sent: SentEmail[] = [];
    let response: Response | undefined;
    await captureEmails(sent, async () => {
      response = await appPost("/v1/accounts/resend-verification", {}, session);
    });

    expect(response!.status).toBe(202);
    expect(await response!.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("resend@example.com");
    expect(sent[0]?.text).toContain(`${env.WEB_ORIGIN}/verify?token=`);

    const emailedToken = verificationTokenFrom(sent[0]!);
    const verifications = await readVerifications(account.id);
    expect(verifications).toHaveLength(1);
    expect(verifications[0]?.purpose).toBe("verify");
    expect(verifications[0]?.used_at).toBeNull();
    expect(verifications[0]!.expires_at - verifications[0]!.created_at).toBe(
      DAY_MS,
    );
    // Only the digest is stored; the email carries the plaintext token.
    expect(verifications[0]?.token_hash).toBe(await hashToken(emailedToken));

    const verify = await post("/v1/accounts/verify-email", {
      token: emailedToken,
    });
    expect(verify.status).toBe(200);
    expect(
      (await readAccount("resend@example.com"))?.email_verified_at,
    ).toBeGreaterThan(0);
  });

  it("acknowledges an already-verified account and sends again", async () => {
    const account = await seedAccount({
      email: "verified-resend@example.com",
      emailVerifiedAt: Date.now() - DAY_MS,
    });
    const session = await loginToken("verified-resend@example.com");

    const sent: SentEmail[] = [];
    let response: Response | undefined;
    await captureEmails(sent, async () => {
      response = await appPost("/v1/accounts/resend-verification", {}, session);
    });

    expect(response!.status).toBe(202);
    expect(await response!.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(await readVerifications(account.id)).toHaveLength(1);
    expect(
      (await readAccount("verified-resend@example.com"))?.email_verified_at,
    ).not.toBeNull();
  });
});

describe("account CORS", () => {
  it("advertises POST for browser preflight from the web origin", async () => {
    const response = await SELF.fetch(`${BASE_URL}/v1/accounts/signup`, {
      method: "OPTIONS",
      headers: {
        Origin: env.WEB_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      env.WEB_ORIGIN,
    );
    const allowMethods = response.headers.get("access-control-allow-methods");
    expect(allowMethods?.split(/,\s*/)).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "Content-Type",
    );
  });
});
