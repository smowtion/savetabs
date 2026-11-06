import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { toBase64Url } from "@savetabs/shared/base64url";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { sha256Hex } from "../src/auth";
import { hashToken, normalizeEmail } from "../src/accounts/tokens";
import {
  consumeEmailSend,
  DAILY_EMAIL_LIMIT,
} from "../src/accounts/email-sends";
import { currentDay } from "../src/counters";

const BASE_URL = "https://savetabs.test";
const CLIENT_AUTH_HASH = "ab".repeat(32);
const OTHER_AUTH_HASH = "cd".repeat(32);
const KDF_SALT = toBase64Url(new Uint8Array(16));
const OTHER_KDF_SALT = toBase64Url(new Uint8Array(16).fill(7));
const KDF_ITERATIONS = 600_000;
const OTHER_KDF_ITERATIONS = 500_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_TTL_MS = 30 * DAY_MS;

const KEY_A = "sync-key-bearer-a";
const KEY_B = "sync-key-bearer-b";

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

interface KeyRowRead {
  auth_id: string;
  key_hash: string;
  created_at: number;
  last_seen_at: number;
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

/**
 * Each request presents a distinct client address. The real per-IP limiter is
 * bound in `wrangler.toml`, and storage (including limiter buckets) is shared
 * across the tests in this file, so a single address would exhaust its budget
 * long before the suite finishes.
 */
function requestIp(): string {
  return `test-${crypto.randomUUID()}`;
}

function post(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cf-connecting-ip": requestIp(),
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
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": requestIp(),
    },
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
    headers: {
      Authorization: `Bearer ${token}`,
      "cf-connecting-ip": requestIp(),
    },
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
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": requestIp(),
        },
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
    "cf-connecting-ip": requestIp(),
  };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return await app.request(
    `${BASE_URL}${path}`,
    { method: "POST", headers, body: JSON.stringify(body) },
    resendEnv(),
    testExecutionContext(),
  );
}

/**
 * `app.request()` runs outside a Worker fetch handler, so it has no
 * ExecutionContext of its own. Routes that hand background work to
 * `waitUntil` need the same one a deployment provides.
 */
function testExecutionContext(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
}

/** Env copy with Resend enabled so the signup routes attempt a send. */
function resendEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: env.DB,
    RELEASES: env.RELEASES,
    WEB_ORIGIN: env.WEB_ORIGIN,
    GLOBAL_DAILY_REQUESTS: env.GLOBAL_DAILY_REQUESTS,
    GLOBAL_MAX_KEYS: env.GLOBAL_MAX_KEYS,
    RESEND_API_KEY: "re_test",
    RESEND_FROM: "SaveTabs <noreply@azcom.dev>",
    ...overrides,
  };
}

/** Seed today's send counter row for an account. */
async function seedEmailSends(
  accountId: string,
  count: number,
  now: number = Date.now(),
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO email_sends (account_id, day, count) VALUES (?, ?, ?)",
  )
    .bind(accountId, currentDay(now), count)
    .run();
}

/** Today's send counter for an account, or null when no row exists. */
function readEmailSends(
  accountId: string,
  now: number = Date.now(),
): Promise<{ count: number } | null> {
  return env.DB.prepare(
    "SELECT count FROM email_sends WHERE account_id = ? AND day = ?",
  )
    .bind(accountId, currentDay(now))
    .first<{ count: number }>();
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

function linkKey(
  token: string | undefined,
  authId: string,
  authKey: string,
  wrappedKey: string,
  authHash: string,
  options: { replace?: boolean } = {},
): Promise<Response> {
  return post(
    "/v1/accounts/key",
    { authId, authKey, wrappedKey, authHash, ...options },
    token,
  );
}

function del(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cf-connecting-ip": requestIp(),
  };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers,
    body: JSON.stringify(body),
  });
}

async function seedKey(authId: string, authKey: string): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO keys (auth_id, key_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(authId, await sha256Hex(authKey), now, now)
    .run();
}

function readKeyRow(authId: string): Promise<KeyRowRead | null> {
  return env.DB.prepare(
    "SELECT auth_id, key_hash, created_at, last_seen_at FROM keys WHERE auth_id = ?",
  )
    .bind(authId)
    .first<KeyRowRead>();
}

async function keyRowExists(authId: string): Promise<boolean> {
  return (await readKeyRow(authId)) !== null;
}

async function seedSession(authId: string, sessionId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sessions (auth_id, session_id, ciphertext, updated_at, size)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(authId, sessionId, new Uint8Array([1, 2, 3]), 1_000, 3)
    .run();
}

async function sessionRowExists(
  authId: string,
  sessionId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT session_id FROM sessions WHERE auth_id = ? AND session_id = ?",
  )
    .bind(authId, sessionId)
    .first();
  return row !== null;
}

async function seedDeletion(authId: string, sessionId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO deletions (auth_id, session_id, deleted_at) VALUES (?, ?, ?)",
  )
    .bind(authId, sessionId, 1_000)
    .run();
}

async function deletionRowExists(
  authId: string,
  sessionId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT session_id FROM deletions WHERE auth_id = ? AND session_id = ?",
  )
    .bind(authId, sessionId)
    .first();
  return row !== null;
}

/** Read the reset-purpose verifications for an account by email. */
async function readResetTokens(email: string): Promise<VerificationRowRead[]> {
  const { results } = await env.DB.prepare(
    `SELECT v.token_hash, v.account_id, v.created_at, v.expires_at,
            v.used_at, v.purpose
       FROM email_verifications v
       JOIN accounts a ON a.id = v.account_id
      WHERE a.email = ? AND v.purpose = 'reset'`,
  )
    .bind(normalizeEmail(email))
    .all<VerificationRowRead>();
  return results;
}

/** Pull the plaintext token out of a reset email. */
function resetTokenFrom(email: SentEmail): string {
  const match = /\/reset\?token=([A-Za-z0-9_-]+)/.exec(email.text);
  expect(match).not.toBeNull();
  return match![1]!;
}

/** A recovery body; overrides let each case change one field. */
function recoveryBody(
  authId: string,
  authKey: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    email: "recovery-target@example.com",
    authId,
    authKey,
    authHash: OTHER_AUTH_HASH,
    kdfSalt: OTHER_KDF_SALT,
    kdfIterations: OTHER_KDF_ITERATIONS,
    wrappedKey: "wrapped-recovered",
    ...overrides,
  };
}

/**
 * D1 storage is not reset between tests in this file, so every fixture that
 * creates an account (or a key row) uses a fresh authId.
 */
function uniqueAuthId(): string {
  return `auth-id-${crypto.randomUUID()}`;
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
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": requestIp(),
          },
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
    // The request locale selects the signup verification copy.
    expect(sent[0]?.subject).toBe("Xác minh email SaveTabs của bạn");
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
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": requestIp(),
          },
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

describe("consumeEmailSend", () => {
  it("allows five sends per UTC day and refuses the next", async () => {
    const now = Date.now();
    const accountId = crypto.randomUUID();

    expect(DAILY_EMAIL_LIMIT).toBe(5);
    for (let attempt = 0; attempt < DAILY_EMAIL_LIMIT; attempt += 1) {
      expect(await consumeEmailSend(env.DB, accountId, now)).toBe(true);
    }
    expect(await consumeEmailSend(env.DB, accountId, now)).toBe(false);
    expect(await consumeEmailSend(env.DB, accountId, now)).toBe(false);

    // Refused attempts must not push the stored count past the cap.
    expect(await readEmailSends(accountId, now)).toEqual({
      count: DAILY_EMAIL_LIMIT,
    });
  });

  it("starts a fresh budget on the next UTC day", async () => {
    const now = Date.now();
    const accountId = crypto.randomUUID();
    await seedEmailSends(accountId, DAILY_EMAIL_LIMIT, now);

    expect(await consumeEmailSend(env.DB, accountId, now)).toBe(false);
    expect(await consumeEmailSend(env.DB, accountId, now + DAY_MS)).toBe(true);
  });

  it("tracks each account independently", async () => {
    const now = Date.now();
    const spent = crypto.randomUUID();
    const fresh = crypto.randomUUID();
    await seedEmailSends(spent, DAILY_EMAIL_LIMIT, now);

    expect(await consumeEmailSend(env.DB, spent, now)).toBe(false);
    expect(await consumeEmailSend(env.DB, fresh, now)).toBe(true);
  });
});

describe("account email rate limit", () => {
  function fakeEmailLimiter(allow: boolean): {
    seen: string[];
    limiter: NonNullable<Env["RATE_LIMITER_EMAIL"]>;
  } {
    const seen: string[] = [];
    return {
      seen,
      limiter: {
        limit: async ({ key }) => {
          seen.push(key);
          return { success: allow };
        },
      },
    };
  }

  async function requestWithLimiter(
    path: string,
    body: unknown,
    limiter: NonNullable<Env["RATE_LIMITER_EMAIL"]>,
    options: { token?: string; method?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "cf-connecting-ip": requestIp(),
    };
    if (options.token !== undefined) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    return await app.request(
      `${BASE_URL}${path}`,
      {
        method: options.method ?? "POST",
        headers,
        body: JSON.stringify(body),
      },
      resendEnv({ RATE_LIMITER_EMAIL: limiter }),
      testExecutionContext(),
    );
  }

  it("charges signup with the normalized email", async () => {
    const { seen, limiter } = fakeEmailLimiter(true);

    const response = await requestWithLimiter(
      "/v1/accounts/signup",
      signupBody({ email: " Limit@Example.com " }),
      limiter,
    );

    expect(response.status).toBe(202);
    expect(seen).toEqual(["email:limit@example.com"]);
  });

  it("charges reset-unlinked with the normalized email", async () => {
    const { seen, limiter } = fakeEmailLimiter(true);

    const response = await requestWithLimiter(
      "/v1/accounts/reset-unlinked",
      { email: " Reset@Example.com", locale: "en" },
      limiter,
    );

    expect(response.status).toBe(202);
    expect(seen).toEqual(["email:reset@example.com"]);
  });

  it("returns the rate_limited envelope without creating an account", async () => {
    const { limiter } = fakeEmailLimiter(false);

    const response = await requestWithLimiter(
      "/v1/accounts/signup",
      signupBody({ email: "blocked@example.com" }),
      limiter,
    );

    expect(response.status).toBe(429);
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      "rate_limited",
    );
    expect(await readAccount("blocked@example.com")).toBeNull();
  });

  it("does not charge invalid bodies", async () => {
    const { seen, limiter } = fakeEmailLimiter(true);

    const signup = await requestWithLimiter(
      "/v1/accounts/signup",
      { ...signupBody({ email: "invalid-limit@example.com" }), authHash: "no" },
      limiter,
    );
    const reset = await requestWithLimiter(
      "/v1/accounts/reset-unlinked",
      { email: 42, locale: "en" },
      limiter,
    );

    expect(signup.status).toBe(400);
    expect(reset.status).toBe(400);
    expect(seen).toEqual([]);
  });

  it("enforces the bound burst budget for one address", async () => {
    const email = `burst-${crypto.randomUUID()}@example.com`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await post(
        "/v1/accounts/signup",
        signupBody({ email }),
      );
      expect(response.status).toBe(202);
    }

    const blocked = await post("/v1/accounts/signup", signupBody({ email }));
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as ErrorBody).error.code).toBe(
      "rate_limited",
    );
  });

  it("charges login with the normalized email even when it is unknown", async () => {
    const { seen, limiter } = fakeEmailLimiter(true);

    const response = await requestWithLimiter(
      "/v1/accounts/login",
      { email: " Nobody@Example.com ", authHash: CLIENT_AUTH_HASH },
      limiter,
    );

    expect(response.status).toBe(401);
    expect(seen).toEqual(["email:nobody@example.com"]);
  });

  it("rate limits the sixth login within the window", async () => {
    const email = `login-limit-${crypto.randomUUID()}@example.com`;
    await seedAccount({ email });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await post("/v1/accounts/login", {
        email,
        authHash: CLIENT_AUTH_HASH,
      });
      expect(response.status).toBe(200);
    }

    const blocked = await post("/v1/accounts/login", {
      email,
      authHash: CLIENT_AUTH_HASH,
    });
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as ErrorBody).error.code).toBe(
      "rate_limited",
    );
  });

  it("charges password changes with the authenticated account email", async () => {
    const email = `limit-password-${crypto.randomUUID()}@example.com`;
    await seedAccount({ email });
    const session = await loginToken(email);
    const { seen, limiter } = fakeEmailLimiter(true);

    const response = await requestWithLimiter(
      "/v1/accounts/password",
      {
        oldAuthHash: CLIENT_AUTH_HASH,
        newAuthHash: OTHER_AUTH_HASH,
        kdfSalt: OTHER_KDF_SALT,
        kdfIterations: OTHER_KDF_ITERATIONS,
        wrappedKey: "wrapped-new",
      },
      limiter,
      { token: session },
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual([`email:${email}`]);
  });

  it("charges recovery with the email from the body", async () => {
    const email = `limit-recover-${crypto.randomUUID()}@example.com`;
    const authId = uniqueAuthId();
    await seedAccount({ email, authId, wrappedKey: "wrapped-old" });
    await seedKey(authId, KEY_A);
    const { seen, limiter } = fakeEmailLimiter(true);

    const response = await requestWithLimiter(
      "/v1/accounts/recover",
      recoveryBody(authId, KEY_A, { email }),
      limiter,
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual([`email:${email}`]);
  });

  it("charges account deletion with the authenticated account email", async () => {
    const email = `limit-delete-${crypto.randomUUID()}@example.com`;
    await seedAccount({ email });
    const session = await loginToken(email);
    const { seen, limiter } = fakeEmailLimiter(true);

    const response = await requestWithLimiter(
      "/v1/accounts",
      { authHash: CLIENT_AUTH_HASH },
      limiter,
      { token: session, method: "DELETE" },
    );

    expect(response.status).toBe(204);
    expect(seen).toEqual([`email:${email}`]);
  });
});

describe("daily email cap", () => {
  it("records one send for a fresh signup", async () => {
    const sent: SentEmail[] = [];
    await captureEmails(sent, async () => {
      const response = await appPost(
        "/v1/accounts/signup",
        signupBody({ email: "cap-signup@example.com" }),
      );
      expect(response.status).toBe(202);
    });

    expect(sent).toHaveLength(1);
    const account = await readAccount("cap-signup@example.com");
    expect(await readEmailSends(account!.id)).toEqual({ count: 1 });
  });

  it("skips the duplicate notice once the account has used its five sends", async () => {
    const account = await seedAccount({ email: "cap-duplicate@example.com" });
    await seedEmailSends(account.id, DAILY_EMAIL_LIMIT);

    const sent: SentEmail[] = [];
    await captureEmails(sent, async () => {
      const response = await appPost(
        "/v1/accounts/signup",
        signupBody({ email: "cap-duplicate@example.com" }),
      );
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ ok: true });
    });

    expect(sent).toHaveLength(0);
    expect(await readEmailSends(account.id)).toEqual({
      count: DAILY_EMAIL_LIMIT,
    });
  });

  it("skips resend-verification once the account has used its five sends", async () => {
    const account = await seedAccount({ email: "cap-resend@example.com" });
    await seedEmailSends(account.id, DAILY_EMAIL_LIMIT);
    const session = await loginToken("cap-resend@example.com");

    const sent: SentEmail[] = [];
    let response: Response | undefined;
    await captureEmails(sent, async () => {
      response = await appPost("/v1/accounts/resend-verification", {}, session);
    });

    expect(response!.status).toBe(202);
    expect(await response!.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("skips the reset email once the account has used its five sends", async () => {
    const account = await seedAccount({ email: "cap-reset@example.com" });
    await seedEmailSends(account.id, DAILY_EMAIL_LIMIT);

    const sent: SentEmail[] = [];
    let response: Response | undefined;
    await captureEmails(sent, async () => {
      response = await appPost("/v1/accounts/reset-unlinked", {
        email: "cap-reset@example.com",
        locale: "en",
      });
    });

    expect(response!.status).toBe(202);
    expect(await response!.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });
});

describe("email provider failures", () => {
  it("keeps the generic signup response when the provider rejects", async () => {
    const originalFetch = globalThis.fetch;
    const originalError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    try {
      const response = await app.request(
        `${BASE_URL}/v1/accounts/signup`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": requestIp(),
          },
          body: JSON.stringify(
            signupBody({ email: `offline-${crypto.randomUUID()}@example.com` }),
          ),
        },
        resendEnv(),
      );

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalError;
    }

    expect(
      logged.some((args) => args[0] === "resend_send_rejected"),
    ).toBe(true);
  });

  it("keeps the resend response when the provider rejects", async () => {
    await seedAccount({ email: "offline-resend@example.com" });
    const session = await loginToken("offline-resend@example.com");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    let response: Response | undefined;
    try {
      response = await appPost("/v1/accounts/resend-verification", {}, session);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(response!.status).toBe(202);
    expect(await response!.json()).toEqual({ ok: true });
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
    // Resends use the locale stored on the account, not the request.
    expect(sent[0]?.subject).toBe("Xác minh email SaveTabs của bạn");
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

describe("POST /v1/accounts/key", () => {
  it("links once, then requires proof and replace to repoint", async () => {
    const authIdA = uniqueAuthId();
    const authIdB = uniqueAuthId();
    await seedAccount({ email: "link@example.com" });
    const session = await loginToken("link@example.com");

    const first = await linkKey(
      session,
      authIdA,
      KEY_A,
      "wrapped-a",
      CLIENT_AUTH_HASH,
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });

    let account = await readAccount("link@example.com");
    expect(account?.auth_id).toBe(authIdA);
    expect(account?.wrapped_key).toBe("wrapped-a");

    // The first link registers an unknown key exactly like the first sync PUT.
    const key = await readKeyRow(authIdA);
    expect(key?.key_hash).toBe(await sha256Hex(KEY_A));

    const blocked = await linkKey(
      session,
      authIdB,
      KEY_B,
      "wrapped-b",
      CLIENT_AUTH_HASH,
    );
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as ErrorBody).error.code).toBe(
      "vault_exists",
    );
    // A rejected link registers nothing.
    expect(await keyRowExists(authIdB)).toBe(false);
    account = await readAccount("link@example.com");
    expect(account?.auth_id).toBe(authIdA);
    expect(account?.wrapped_key).toBe("wrapped-a");

    const wrongProof = await linkKey(
      session,
      authIdB,
      KEY_B,
      "wrapped-b",
      OTHER_AUTH_HASH,
      { replace: true },
    );
    expect(wrongProof.status).toBe(401);
    expect(((await wrongProof.json()) as ErrorBody).error.code).toBe(
      "proof_required",
    );
    expect(await keyRowExists(authIdB)).toBe(false);
    account = await readAccount("link@example.com");
    expect(account?.auth_id).toBe(authIdA);

    const replaced = await linkKey(
      session,
      authIdB,
      KEY_B,
      "wrapped-b",
      CLIENT_AUTH_HASH,
      { replace: true },
    );
    expect(replaced.status).toBe(200);
    account = await readAccount("link@example.com");
    expect(account?.auth_id).toBe(authIdB);
    expect(account?.wrapped_key).toBe("wrapped-b");

    // The same key may re-wrap the vault without replace or proof.
    const rewrapped = await linkKey(
      session,
      authIdB,
      KEY_B,
      "wrapped-b2",
      CLIENT_AUTH_HASH,
    );
    expect(rewrapped.status).toBe(200);
    account = await readAccount("link@example.com");
    expect(account?.auth_id).toBe(authIdB);
    expect(account?.wrapped_key).toBe("wrapped-b2");
  });

  it("refuses a key linked to another account and a wrong key bearer", async () => {
    const authId = uniqueAuthId();
    await seedAccount({ email: "owner@example.com" });
    await seedAccount({ email: "other@example.com" });
    const owner = await loginToken("owner@example.com");
    const other = await loginToken("other@example.com");

    const linked = await linkKey(
      owner,
      authId,
      KEY_A,
      "wrapped-a",
      CLIENT_AUTH_HASH,
    );
    expect(linked.status).toBe(200);

    const taken = await linkKey(
      other,
      authId,
      KEY_A,
      "wrapped-x",
      CLIENT_AUTH_HASH,
    );
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as ErrorBody).error.code).toBe(
      "auth_id_taken",
    );
    expect((await readAccount("other@example.com"))?.auth_id).toBeNull();

    // A registered authId is only usable with the bearer it was registered for.
    const wrongBearer = await linkKey(
      other,
      authId,
      "not-the-registered-key",
      "wrapped-x",
      CLIENT_AUTH_HASH,
    );
    expect(wrongBearer.status).toBe(401);
    expect(((await wrongBearer.json()) as ErrorBody).error.code).toBe(
      "unauthorized",
    );
    expect((await readAccount("other@example.com"))?.auth_id).toBeNull();
  });

  it("requires an account token and valid fields", async () => {
    const authId = uniqueAuthId();
    const account = await seedAccount({ email: "link-validation@example.com" });

    const missing = await linkKey(
      undefined,
      authId,
      KEY_A,
      "wrapped",
      CLIENT_AUTH_HASH,
    );
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as ErrorBody).error.code).toBe(
      "unauthorized",
    );

    const session = await loginToken("link-validation@example.com");
    const invalidBodies: unknown[] = [
      {},
      { authId, authKey: KEY_A, wrappedKey: "wrapped" },
      { authId: "", authKey: KEY_A, wrappedKey: "wrapped", authHash: CLIENT_AUTH_HASH },
      { authId, authKey: 42, wrappedKey: "wrapped", authHash: CLIENT_AUTH_HASH },
      { authId, authKey: KEY_A, wrappedKey: "", authHash: CLIENT_AUTH_HASH },
      { authId, authKey: KEY_A, wrappedKey: "wrapped", authHash: "AB".repeat(32) },
      { authId, authKey: KEY_A, wrappedKey: "wrapped", authHash: CLIENT_AUTH_HASH, replace: "yes" },
      [],
    ];

    for (const invalid of invalidBodies) {
      const response = await post("/v1/accounts/key", invalid, session);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "invalid_request",
      );
    }

    // Rejected bodies never register a key.
    expect(await keyRowExists(authId)).toBe(false);
    expect(await readAccount("link-validation@example.com")).toEqual({
      ...account,
      auth_hash: await sha256Hex(CLIENT_AUTH_HASH),
      kdf_salt: KDF_SALT,
      kdf_iterations: KDF_ITERATIONS,
      wrapped_key: null,
      auth_id: null,
      locale: "en",
      email_verified_at: null,
    });
  });

  it("rejects a new key once the global key capacity is spent", async () => {
    await seedAccount({ email: "key-cap@example.com" });
    const session = await loginToken("key-cap@example.com");
    const authId = uniqueAuthId();
    const maxKeys = Number(env.GLOBAL_MAX_KEYS);

    await env.DB.prepare(
      `INSERT INTO counters (day, requests, keys_created) VALUES (?, 0, ?)
       ON CONFLICT (day) DO UPDATE SET keys_created = excluded.keys_created`,
    )
      .bind(currentDay(), maxKeys)
      .run();

    try {
      const rejected = await linkKey(
        session,
        authId,
        KEY_A,
        "wrapped",
        CLIENT_AUTH_HASH,
      );
      expect(rejected.status).toBe(429);
      expect(((await rejected.json()) as ErrorBody).error.code).toBe(
        "capacity_exceeded",
      );
      expect(await keyRowExists(authId)).toBe(false);
      expect((await readAccount("key-cap@example.com"))?.auth_id).toBeNull();

      // An already-registered key is verified, not charged: the cap only
      // applies to new key rows.
      await seedKey(authId, KEY_A);
      const existing = await linkKey(
        session,
        authId,
        KEY_A,
        "wrapped",
        CLIENT_AUTH_HASH,
      );
      expect(existing.status).toBe(200);
      expect((await readAccount("key-cap@example.com"))?.auth_id).toBe(authId);
    } finally {
      // The counter row is shared by the rest of the file.
      await env.DB.prepare("DELETE FROM counters WHERE day = ?")
        .bind(currentDay())
        .run();
    }
  });
});

describe("POST /v1/accounts/password", () => {
  it("changes the proof, revokes every token and returns a fresh one", async () => {
    const authId = uniqueAuthId();
    const seeded = await seedAccount({
      email: "password@example.com",
      authId,
      wrappedKey: "wrapped-old",
    });
    const first = await loginToken("password@example.com");
    const second = await loginToken("password@example.com");

    const response = await post(
      "/v1/accounts/password",
      {
        oldAuthHash: CLIENT_AUTH_HASH,
        newAuthHash: OTHER_AUTH_HASH,
        kdfSalt: OTHER_KDF_SALT,
        kdfIterations: OTHER_KDF_ITERATIONS,
        wrappedKey: "wrapped-new",
      },
      first,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Every old session is revoked; only the returned bearer works.
    expect((await meStatus(first)).status).toBe(401);
    expect((await meStatus(second)).status).toBe(401);
    expect((await meStatus(body.token)).status).toBe(200);

    const account = await readAccount("password@example.com");
    expect(account?.auth_hash).toBe(await sha256Hex(OTHER_AUTH_HASH));
    expect(account?.kdf_salt).toBe(OTHER_KDF_SALT);
    expect(account?.kdf_iterations).toBe(OTHER_KDF_ITERATIONS);
    expect(account?.wrapped_key).toBe("wrapped-new");
    expect(account?.auth_id).toBe(authId);
    expect(await readTokens(seeded.id)).toHaveLength(1);
    expect((await readTokens(seeded.id))[0]?.token_hash).toBe(
      await hashToken(body.token),
    );

    const oldLogin = await post("/v1/accounts/login", {
      email: "password@example.com",
      authHash: CLIENT_AUTH_HASH,
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await post("/v1/accounts/login", {
      email: "password@example.com",
      authHash: OTHER_AUTH_HASH,
    });
    expect(newLogin.status).toBe(200);
  });

  it("rejects a wrong current proof without touching the account", async () => {
    const authId = uniqueAuthId();
    const seeded = await seedAccount({
      email: "wrong-old@example.com",
      authId,
      wrappedKey: "wrapped-old",
    });
    const session = await loginToken("wrong-old@example.com");

    const response = await post(
      "/v1/accounts/password",
      {
        oldAuthHash: OTHER_AUTH_HASH,
        newAuthHash: OTHER_AUTH_HASH,
        kdfSalt: OTHER_KDF_SALT,
        kdfIterations: OTHER_KDF_ITERATIONS,
        wrappedKey: "wrapped-new",
      },
      session,
    );

    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      "proof_required",
    );

    const account = await readAccount("wrong-old@example.com");
    expect(account?.auth_hash).toBe(await sha256Hex(CLIENT_AUTH_HASH));
    expect(account?.kdf_salt).toBe(KDF_SALT);
    expect(account?.kdf_iterations).toBe(KDF_ITERATIONS);
    expect(account?.wrapped_key).toBe("wrapped-old");
    expect(await readTokens(seeded.id)).toHaveLength(1);
    expect((await meStatus(session)).status).toBe(200);
  });

  it("requires an account token and valid fields", async () => {
    const missing = await post("/v1/accounts/password", {});
    expect(missing.status).toBe(401);

    await seedAccount({ email: "password-validation@example.com" });
    const session = await loginToken("password-validation@example.com");
    const valid = {
      oldAuthHash: CLIENT_AUTH_HASH,
      newAuthHash: OTHER_AUTH_HASH,
      kdfSalt: OTHER_KDF_SALT,
      kdfIterations: OTHER_KDF_ITERATIONS,
      wrappedKey: "wrapped-new",
    };
    const invalidBodies: unknown[] = [
      {},
      { ...valid, oldAuthHash: "AB".repeat(32) },
      { ...valid, newAuthHash: 42 },
      { ...valid, kdfSalt: "AAAA" },
      { ...valid, kdfIterations: 99_999 },
      { ...valid, wrappedKey: "" },
      [],
    ];

    for (const invalid of invalidBodies) {
      const response = await post("/v1/accounts/password", invalid, session);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "invalid_request",
      );
    }

    expect((await meStatus(session)).status).toBe(200);
    expect((await readAccount("password-validation@example.com"))?.auth_hash).toBe(
      await sha256Hex(CLIENT_AUTH_HASH),
    );
  });
});

describe("POST /v1/accounts/recover", () => {
  it("resets the proof and vault when the recovery key owns the account", async () => {
    const authId = uniqueAuthId();
    const seeded = await seedAccount({
      email: "recover@example.com",
      authId,
      wrappedKey: "wrapped-old",
    });
    await seedKey(authId, KEY_A);
    const oldSession = await loginToken("recover@example.com");

    const response = await post(
      "/v1/accounts/recover",
      recoveryBody(authId, KEY_A, {
        email: " Recover@Example.com ",
        wrappedKey: "wrapped-recovered",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const account = await readAccount("recover@example.com");
    expect(account?.auth_hash).toBe(await sha256Hex(OTHER_AUTH_HASH));
    expect(account?.kdf_salt).toBe(OTHER_KDF_SALT);
    expect(account?.kdf_iterations).toBe(OTHER_KDF_ITERATIONS);
    expect(account?.wrapped_key).toBe("wrapped-recovered");
    expect(account?.auth_id).toBe(authId);

    // Recovery revokes every account token.
    expect(await readTokens(seeded.id)).toHaveLength(0);
    expect((await meStatus(oldSession)).status).toBe(401);

    const oldLogin = await post("/v1/accounts/login", {
      email: "recover@example.com",
      authHash: CLIENT_AUTH_HASH,
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await post("/v1/accounts/login", {
      email: "recover@example.com",
      authHash: OTHER_AUTH_HASH,
    });
    expect(newLogin.status).toBe(200);
    expect(((await newLogin.json()) as LoginBody).vault?.wrappedKey).toBe(
      "wrapped-recovered",
    );
  });

  it("rejects recovery when the key does not own the account", async () => {
    const authIdA = uniqueAuthId();
    const authIdB = uniqueAuthId();
    await seedAccount({
      email: "recovery-target@example.com",
      authId: authIdA,
      wrappedKey: "wrapped-old",
    });
    await seedKey(authIdA, KEY_A);
    await seedKey(authIdB, KEY_B);

    const wrongKey = await post(
      "/v1/accounts/recover",
      recoveryBody(authIdA, KEY_B),
    );
    expect(wrongKey.status).toBe(404);
    expect(((await wrongKey.json()) as ErrorBody).error.code).toBe("not_found");

    // Unknown email, unknown authId and a mismatched authId are indistinguishable.
    const cases = [
      recoveryBody(authIdA, KEY_A, { email: "nobody@example.com" }),
      recoveryBody("unknown-auth-id", KEY_A),
      recoveryBody(authIdB, KEY_A),
    ];
    for (const candidate of cases) {
      const response = await post("/v1/accounts/recover", candidate);
      expect(response.status).toBe(404);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "not_found",
      );
    }

    const account = await readAccount("recovery-target@example.com");
    expect(account?.auth_hash).toBe(await sha256Hex(CLIENT_AUTH_HASH));
    expect(account?.wrapped_key).toBe("wrapped-old");
  });

  it("rejects malformed bodies", async () => {
    const valid = recoveryBody(uniqueAuthId(), KEY_A);
    const invalidBodies: unknown[] = [
      {},
      { ...valid, email: 42 },
      { ...valid, email: "   " },
      { ...valid, authId: "" },
      { ...valid, authKey: 42 },
      { ...valid, authHash: "CD".repeat(32) },
      { ...valid, kdfSalt: "AAAA" },
      { ...valid, kdfIterations: "600000" },
      { ...valid, wrappedKey: "" },
      [],
    ];

    for (const invalid of invalidBodies) {
      const response = await post("/v1/accounts/recover", invalid);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "invalid_request",
      );
    }
  });
});

describe("POST /v1/accounts/reset-unlinked", () => {
  it("emails a 24-hour reset link to an account with no vault", async () => {
    await seedAccount({ email: "Reset@Example.com ", locale: "vi" });

    const sent: SentEmail[] = [];
    let response: Response | undefined;
    await captureEmails(sent, async () => {
      // The request locale is deliberately different: the stored account
      // locale is what selects the reset copy.
      response = await appPost("/v1/accounts/reset-unlinked", {
        email: " Reset@Example.com",
        locale: "en",
      });
    });

    expect(response!.status).toBe(202);
    expect(await response!.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("reset@example.com");
    expect(sent[0]?.subject).toBe("Đặt lại mật khẩu SaveTabs của bạn");
    expect(sent[0]?.html).toContain(`${env.WEB_ORIGIN}/reset?token=`);
    expect(sent[0]?.text).toContain(`${env.WEB_ORIGIN}/reset?token=`);

    const tokens = await readResetTokens("reset@example.com");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.purpose).toBe("reset");
    expect(tokens[0]?.used_at).toBeNull();
    expect(tokens[0]!.expires_at - tokens[0]!.created_at).toBe(DAY_MS);
    // Only the digest is stored; the email carries the plaintext token.
    expect(tokens[0]?.token_hash).toBe(
      await hashToken(resetTokenFrom(sent[0]!)),
    );
  });

  it("never resets an account that has a vault", async () => {
    await seedAccount({
      email: "vaulted@example.com",
      authId: uniqueAuthId(),
      wrappedKey: "wrapped",
    });

    const sent: SentEmail[] = [];
    let response: Response | undefined;
    await captureEmails(sent, async () => {
      response = await appPost("/v1/accounts/reset-unlinked", {
        email: "vaulted@example.com",
        locale: "en",
      });
    });

    expect(response!.status).toBe(202);
    expect(await response!.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
    expect(await readResetTokens("vaulted@example.com")).toHaveLength(0);
  });

  it("answers unknown and known emails the same way", async () => {
    await seedAccount({
      email: "verified-unlinked@example.com",
      emailVerifiedAt: Date.now() - DAY_MS,
    });

    const sent: SentEmail[] = [];
    let unknown: Response | undefined;
    let verified: Response | undefined;
    await captureEmails(sent, async () => {
      unknown = await appPost("/v1/accounts/reset-unlinked", {
        email: "nobody@example.com",
        locale: "en",
      });
      verified = await appPost("/v1/accounts/reset-unlinked", {
        email: "verified-unlinked@example.com",
        locale: "en",
      });
    });

    expect(unknown!.status).toBe(202);
    expect(verified!.status).toBe(202);
    expect(await unknown!.json()).toEqual(await verified!.json());
    // Only the existing account gets an email; a verified account with no
    // vault can still reset because there is nothing encrypted.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("verified-unlinked@example.com");
    expect(await readResetTokens("verified-unlinked@example.com")).toHaveLength(
      1,
    );
  });

  it("rejects malformed bodies", async () => {
    for (const invalid of [
      {},
      { email: 42, locale: "en" },
      { email: "   ", locale: "en" },
      { email: "a@b.c", locale: 42 },
      [],
      null,
    ]) {
      const response = await post("/v1/accounts/reset-unlinked", invalid);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "invalid_request",
      );
    }
  });
});

describe("POST /v1/accounts/reset-unlinked/confirm", () => {
  const newProof = {
    authHash: OTHER_AUTH_HASH,
    kdfSalt: OTHER_KDF_SALT,
    kdfIterations: OTHER_KDF_ITERATIONS,
  };

  it("sets a new proof once for an account with no vault", async () => {
    const resetToken = `reset-${crypto.randomUUID()}`;
    const seeded = await seedAccount({ email: "confirm@example.com" });
    await seedVerification(seeded.id, resetToken, { purpose: "reset" });
    const oldSession = await loginToken("confirm@example.com");
    expect(
      (await readAccount("confirm@example.com"))?.email_verified_at,
    ).toBeNull();

    const response = await post("/v1/accounts/reset-unlinked/confirm", {
      token: resetToken,
      ...newProof,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const account = await readAccount("confirm@example.com");
    expect(account?.auth_hash).toBe(await sha256Hex(OTHER_AUTH_HASH));
    expect(account?.kdf_salt).toBe(OTHER_KDF_SALT);
    expect(account?.kdf_iterations).toBe(OTHER_KDF_ITERATIONS);
    expect(account?.auth_id).toBeNull();
    // Consuming the emailed link proves mailbox control, so the account is
    // verified and the unverified-account cleanup can no longer sweep it.
    expect(account?.email_verified_at).toBeGreaterThan(0);
    // Resetting the password revokes existing sessions.
    expect(await readTokens(seeded.id)).toHaveLength(0);
    expect((await meStatus(oldSession)).status).toBe(401);

    const verifications = await readVerifications(seeded.id);
    expect(verifications).toHaveLength(1);
    expect(verifications[0]?.used_at).toBeGreaterThan(0);

    expect(
      (
        await post("/v1/accounts/login", {
          email: "confirm@example.com",
          authHash: CLIENT_AUTH_HASH,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await post("/v1/accounts/login", {
          email: "confirm@example.com",
          authHash: OTHER_AUTH_HASH,
        })
      ).status,
    ).toBe(200);

    const again = await post("/v1/accounts/reset-unlinked/confirm", {
      token: resetToken,
      ...newProof,
    });
    expect(again.status).toBe(410);
    expect(((await again.json()) as ErrorBody).error.code).toBe(
      "invalid_token",
    );
  });

  it("rejects expired, used, wrong-purpose and vaulted resets", async () => {
    const unlinked = await seedAccount({ email: "bad-reset@example.com" });
    const linked = await seedAccount({
      email: "linked-reset@example.com",
      authId: uniqueAuthId(),
      wrappedKey: "wrapped",
    });
    const now = Date.now();
    await seedVerification(unlinked.id, "expired-reset", {
      purpose: "reset",
      expiresAt: now - 1,
    });
    await seedVerification(unlinked.id, "used-reset", {
      purpose: "reset",
      usedAt: now - DAY_MS,
    });
    await seedVerification(unlinked.id, "verify-purpose", {
      purpose: "verify",
    });
    await seedVerification(linked.id, "vaulted-reset", { purpose: "reset" });

    for (const token of [
      "unknown-token",
      "expired-reset",
      "used-reset",
      "verify-purpose",
      "vaulted-reset",
    ]) {
      const response = await post("/v1/accounts/reset-unlinked/confirm", {
        token,
        ...newProof,
      });
      expect(response.status).toBe(410);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "invalid_token",
      );
    }

    // The linked account still holds its original proof.
    expect((await readAccount("linked-reset@example.com"))?.auth_hash).toBe(
      await sha256Hex(CLIENT_AUTH_HASH),
    );
    const vaultedTokenHash = await hashToken("vaulted-reset");
    const vaultedRow = (await readVerifications(linked.id)).find(
      (row) => row.token_hash === vaultedTokenHash,
    );
    expect(vaultedRow?.used_at).toBeNull();
  });

  it("rejects malformed bodies", async () => {
    for (const invalid of [
      {},
      { token: 42, ...newProof },
      { token: "", ...newProof },
      { token: "t", ...newProof, authHash: "AB".repeat(32) },
      { token: "t", ...newProof, kdfSalt: "AAAA" },
      { token: "t", ...newProof, kdfIterations: 2_000_001 },
      [],
    ]) {
      const response = await post(
        "/v1/accounts/reset-unlinked/confirm",
        invalid,
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "invalid_request",
      );
    }
  });
});

describe("DELETE /v1/accounts", () => {
  it("deletes the account without touching sync data", async () => {
    const authId = uniqueAuthId();
    const seeded = await seedAccount({
      email: "delete@example.com",
      authId,
      wrappedKey: "wrapped",
    });
    await seedKey(authId, KEY_A);
    await seedSession(authId, "session-1");
    await seedDeletion(authId, "session-2");
    await seedVerification(seeded.id, "verify-token");
    await seedEmailSends(seeded.id, 1);
    const session = await loginToken("delete@example.com");

    const response = await del(
      "/v1/accounts",
      { authHash: CLIENT_AUTH_HASH },
      session,
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");

    expect(await readAccount("delete@example.com")).toBeNull();
    expect(await readTokens(seeded.id)).toHaveLength(0);
    expect(await readVerifications(seeded.id)).toHaveLength(0);
    expect(await readEmailSends(seeded.id)).toBeNull();
    // Sync data and the key registration are untouched.
    expect(await keyRowExists(authId)).toBe(true);
    expect(await sessionRowExists(authId, "session-1")).toBe(true);
    expect(await deletionRowExists(authId, "session-2")).toBe(true);
    expect((await meStatus(session)).status).toBe(401);
  });

  it("requires the correct password proof", async () => {
    await seedAccount({ email: "delete-proof@example.com" });
    const session = await loginToken("delete-proof@example.com");

    const response = await del(
      "/v1/accounts",
      { authHash: OTHER_AUTH_HASH },
      session,
    );
    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      "proof_required",
    );

    expect(await readAccount("delete-proof@example.com")).not.toBeNull();
    expect((await meStatus(session)).status).toBe(200);
  });

  it("requires an account token and valid fields", async () => {
    await seedAccount({ email: "delete-validation@example.com" });
    const session = await loginToken("delete-validation@example.com");

    const missing = await del("/v1/accounts", { authHash: CLIENT_AUTH_HASH });
    expect(missing.status).toBe(401);

    for (const invalid of [{}, { authHash: "AB".repeat(32) }, { authHash: 42 }, []]) {
      const response = await del("/v1/accounts", invalid, session);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "invalid_request",
      );
    }

    expect(await readAccount("delete-validation@example.com")).not.toBeNull();
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
