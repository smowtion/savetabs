import { Hono } from "hono";
import { decodeSalt } from "@savetabs/shared/account/kdf";
import { sendEmail, verificationEmail } from "../accounts/email";
import { createToken, hashToken, normalizeEmail } from "../accounts/tokens";
import { parseBearer, sha256Hex, timingSafeEqual } from "../auth";
import type { Env } from "../env";
import { apiError, type AppContext } from "../errors";

/** Account tokens last 30 days; verification links last 24 hours. */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** The client proof is 32 bytes, sent as lowercase hex. */
const AUTH_HASH_PATTERN = /^[0-9a-f]{64}$/;
const KDF_SALT_BYTES = 16;
const MIN_KDF_ITERATIONS = 100_000;
const MAX_KDF_ITERATIONS = 2_000_000;

/** Compared against for unknown emails so login has one comparison path. */
const DUMMY_AUTH_HASH = "0".repeat(64);

interface AccountRow {
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

interface ProfileResponse {
  id: string;
  email: string;
  emailVerified: boolean;
  authId: string | null;
  locale: string;
}

interface VaultResponse {
  wrappedKey: string;
  kdfSalt: string;
  kdfIterations: number;
  authId: string;
}

export const accountsRoutes = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

accountsRoutes.post("/accounts/signup", async (c) => {
  const body = await readJsonBody(c);
  if (body === null) return invalidRequest(c);

  const email =
    typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const { authHash, kdfSalt, kdfIterations, locale } = body;

  if (email.length === 0) return invalidRequest(c);
  if (typeof authHash !== "string" || !AUTH_HASH_PATTERN.test(authHash)) {
    return invalidRequest(c);
  }
  if (typeof kdfSalt !== "string" || !isValidSalt(kdfSalt)) {
    return invalidRequest(c);
  }
  if (!isValidIterations(kdfIterations)) return invalidRequest(c);
  if (typeof locale !== "string") return invalidRequest(c);

  const now = Date.now();
  const accountId = crypto.randomUUID();
  const inserted = await c.env.DB.prepare(
    `INSERT INTO accounts
       (id, email, auth_hash, kdf_salt, kdf_iterations, locale, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (email) DO NOTHING`,
  )
    .bind(
      accountId,
      email,
      await sha256Hex(authHash),
      kdfSalt,
      kdfIterations,
      locale,
      now,
      now,
    )
    .run();

  // An existing address gets a generic notice, never a second account or a
  // verification token. The response is identical to a fresh signup.
  if ((inserted.meta.changes ?? 0) === 0) {
    await sendEmail(c.env, { to: email, ...signupNotice(c.env.WEB_ORIGIN) });
    return c.json({ ok: true }, 202);
  }

  const { token, tokenHash } = await createToken();
  await c.env.DB.prepare(
    `INSERT INTO email_verifications
       (token_hash, account_id, created_at, expires_at, used_at, purpose)
     VALUES (?, ?, ?, ?, NULL, 'verify')`,
  )
    .bind(tokenHash, accountId, now, now + VERIFICATION_TTL_MS)
    .run();

  const link = `${c.env.WEB_ORIGIN}/verify?token=${token}`;
  await sendEmail(c.env, { to: email, ...verificationEmail(locale, link) });

  return c.json({ ok: true }, 202);
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

accountsRoutes.post("/accounts/login", async (c) => {
  const body = await readJsonBody(c);
  if (body === null) return invalidRequest(c);

  const { email, authHash } = body;
  if (typeof email !== "string" || typeof authHash !== "string") {
    return invalidRequest(c);
  }

  const digest = await sha256Hex(authHash);
  const account = await c.env.DB.prepare(
    `SELECT id, email, auth_hash, kdf_salt, kdf_iterations, wrapped_key,
            auth_id, locale, email_verified_at
       FROM accounts WHERE email = ?`,
  )
    .bind(normalizeEmail(email))
    .first<AccountRow>();

  if (account === null) {
    // Spend the same comparison as a real account so a missing email does not
    // become a timing oracle, then answer exactly like a wrong proof.
    void timingSafeEqual(digest, DUMMY_AUTH_HASH);
    return invalidCredentials(c);
  }

  if (!timingSafeEqual(account.auth_hash, digest)) {
    return invalidCredentials(c);
  }

  const now = Date.now();
  const { token, tokenHash } = await createToken();
  await c.env.DB.prepare(
    `INSERT INTO account_tokens
       (token_hash, account_id, created_at, expires_at, last_used_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(tokenHash, account.id, now, now + TOKEN_TTL_MS, now)
    .run();

  return c.json({
    token,
    account: toProfile(account),
    vault: toVault(account),
  });
});

// ---------------------------------------------------------------------------
// Profile and logout
// ---------------------------------------------------------------------------

accountsRoutes.get("/accounts/me", async (c) => {
  const auth = await authenticateAccount(c);
  if ("response" in auth) return auth.response;

  return c.json(toProfile(auth.account));
});

accountsRoutes.post("/accounts/logout", async (c) => {
  const bearer = parseBearer(c.req.header("authorization"));
  if (bearer === null) return unauthorized(c);

  const deleted = await c.env.DB.prepare(
    "DELETE FROM account_tokens WHERE token_hash = ?",
  )
    .bind(await hashToken(bearer))
    .run();

  if ((deleted.meta.changes ?? 0) === 0) return unauthorized(c);
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

accountsRoutes.post("/accounts/verify-email", async (c) => {
  const body = await readJsonBody(c);
  if (body === null || typeof body.token !== "string") {
    return invalidRequest(c);
  }

  const now = Date.now();
  const tokenHash = await hashToken(body.token);

  const verification = await c.env.DB.prepare(
    `SELECT account_id FROM email_verifications
      WHERE token_hash = ? AND purpose = 'verify'
        AND used_at IS NULL AND expires_at > ?`,
  )
    .bind(tokenHash, now)
    .first<{ account_id: string }>();

  if (verification === null) return invalidToken(c);

  // Repeating the predicate in the UPDATE lets a concurrent second request
  // lose the race instead of consuming the same token twice.
  const claimed = await c.env.DB.prepare(
    `UPDATE email_verifications SET used_at = ?
      WHERE token_hash = ? AND purpose = 'verify'
        AND used_at IS NULL AND expires_at > ?`,
  )
    .bind(now, tokenHash, now)
    .run();

  if ((claimed.meta.changes ?? 0) === 0) return invalidToken(c);

  await c.env.DB.prepare(
    "UPDATE accounts SET email_verified_at = ?, updated_at = ? WHERE id = ?",
  )
    .bind(now, now, verification.account_id)
    .run();

  return c.json({ verified: true });
});

accountsRoutes.post("/accounts/resend-verification", async (c) => {
  const auth = await authenticateAccount(c);
  if ("response" in auth) return auth.response;

  const now = Date.now();
  const { token, tokenHash } = await createToken();
  await c.env.DB.prepare(
    `INSERT INTO email_verifications
       (token_hash, account_id, created_at, expires_at, used_at, purpose)
     VALUES (?, ?, ?, ?, NULL, 'verify')`,
  )
    .bind(tokenHash, auth.account.id, now, now + VERIFICATION_TTL_MS)
    .run();

  // A fresh link goes out whether or not the account is already verified, so
  // the response never reveals the current verification state.
  const link = `${c.env.WEB_ORIGIN}/verify?token=${token}`;
  await sendEmail(c.env, {
    to: auth.account.email,
    ...verificationEmail(auth.account.locale, link),
  });

  return c.json({ ok: true }, 202);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AccountAuth = { account: AccountRow } | { response: Response };

/**
 * Resolve the account token on the request. Tokens are stored only as their
 * SHA-256 digest, so the bearer is hashed before the lookup.
 */
async function authenticateAccount(c: AppContext): Promise<AccountAuth> {
  const bearer = parseBearer(c.req.header("authorization"));
  if (bearer === null) return { response: unauthorized(c) };

  const tokenHash = await hashToken(bearer);
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `SELECT a.id, a.email, a.auth_hash, a.kdf_salt, a.kdf_iterations,
            a.wrapped_key, a.auth_id, a.locale, a.email_verified_at,
            t.expires_at
       FROM account_tokens t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<AccountRow & { expires_at: number }>();

  if (row === null || row.expires_at <= now) {
    return { response: unauthorized(c) };
  }

  await c.env.DB.prepare(
    "UPDATE account_tokens SET last_used_at = ? WHERE token_hash = ?",
  )
    .bind(now, tokenHash)
    .run();

  return { account: row };
}

function toProfile(account: AccountRow): ProfileResponse {
  return {
    id: account.id,
    email: account.email,
    emailVerified: account.email_verified_at !== null,
    authId: account.auth_id,
    locale: account.locale,
  };
}

/** The vault exists only after the key-linking flow set both columns. */
function toVault(account: AccountRow): VaultResponse | null {
  if (account.wrapped_key === null || account.auth_id === null) return null;

  return {
    wrappedKey: account.wrapped_key,
    kdfSalt: account.kdf_salt,
    kdfIterations: account.kdf_iterations,
    authId: account.auth_id,
  };
}

/** A duplicate signup gets a notice that reveals nothing about the account. */
function signupNotice(webOrigin: string) {
  const link = `${webOrigin}/login`;
  return {
    subject: "Someone tried to create a SaveTabs account with your email",
    html: [
      "<p>Someone tried to create a SaveTabs account with this email address.</p>",
      `<p>If this was you, sign in instead: <a href="${link}">Sign in</a></p>`,
      "<p>If it was not you, you can safely ignore this email.</p>",
    ].join("\n"),
    text: [
      "Someone tried to create a SaveTabs account with this email address.",
      "",
      `If this was you, sign in instead: ${link}`,
      "",
      "If it was not you, you can safely ignore this email.",
    ].join("\n"),
  };
}

async function readJsonBody(
  c: AppContext,
): Promise<Record<string, unknown> | null> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isValidSalt(value: string): boolean {
  try {
    return decodeSalt(value).byteLength === KDF_SALT_BYTES;
  } catch {
    return false;
  }
}

function isValidIterations(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_KDF_ITERATIONS &&
    value <= MAX_KDF_ITERATIONS
  );
}

function invalidRequest(c: AppContext) {
  return apiError(c, 400, "invalid_request", "Request body is invalid.");
}

function invalidCredentials(c: AppContext) {
  return apiError(
    c,
    401,
    "invalid_credentials",
    "Email or password is incorrect.",
  );
}

function invalidToken(c: AppContext) {
  return apiError(
    c,
    410,
    "invalid_token",
    "The verification link is invalid or has expired.",
  );
}

function unauthorized(c: AppContext) {
  return apiError(c, 401, "unauthorized", "A valid account token is required.");
}
