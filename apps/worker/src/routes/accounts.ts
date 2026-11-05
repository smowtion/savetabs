import { Hono } from "hono";
import { decodeSalt } from "@savetabs/shared/account/kdf";
import {
  resetEmail,
  sendEmail,
  verificationEmail,
} from "../accounts/email";
import { createToken, hashToken, normalizeEmail } from "../accounts/tokens";
import { parseBearer, sha256Hex, timingSafeEqual } from "../auth";
import {
  DEFAULT_MAX_KEYS,
  keysCreatedToday,
  parseLimit,
  recordKeyCreated,
} from "../counters";
import type { Env } from "../env";
import { apiError, type AppContext } from "../errors";

/** Account tokens last 30 days; verification and reset links last 24 hours. */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = VERIFICATION_TTL_MS;

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

interface KeyRow {
  key_hash: string;
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
// Key linking
// ---------------------------------------------------------------------------

accountsRoutes.post("/accounts/key", async (c) => {
  const auth = await authenticateAccount(c);
  if ("response" in auth) return auth.response;

  const body = await readJsonBody(c);
  if (body === null) return invalidRequest(c);

  const { authId, authKey, wrappedKey, authHash, replace } = body;
  if (
    !isNonEmptyString(authId) ||
    !isNonEmptyString(authKey) ||
    !isNonEmptyString(wrappedKey) ||
    typeof authHash !== "string" ||
    !AUTH_HASH_PATTERN.test(authHash)
  ) {
    return invalidRequest(c);
  }
  if (replace !== undefined && typeof replace !== "boolean") {
    return invalidRequest(c);
  }

  const keyHash = await sha256Hex(authKey);
  const now = Date.now();

  // An already-registered key must match its bearer before the link is
  // considered. This check writes nothing.
  const existingKey = await loadKey(c.env.DB, authId);
  if (existingKey !== null && !timingSafeEqual(existingKey.key_hash, keyHash)) {
    return invalidKey(c);
  }

  // The sync key belongs to at most one account. These checks run before any
  // insert, so a rejected link never leaves an orphan key row behind.
  const linked = await c.env.DB.prepare(
    "SELECT id FROM accounts WHERE auth_id = ?",
  )
    .bind(authId)
    .first<{ id: string }>();

  if (linked !== null && linked.id !== auth.account.id) {
    return apiError(
      c,
      409,
      "auth_id_taken",
      "This sync key is linked to another account.",
    );
  }

  const alreadyLinked = auth.account.auth_id !== null;
  if (alreadyLinked && auth.account.auth_id !== authId) {
    if (replace !== true) {
      return apiError(
        c,
        409,
        "vault_exists",
        "This account already has a different sync key.",
      );
    }

    const digest = await sha256Hex(authHash);
    if (!timingSafeEqual(auth.account.auth_hash, digest)) {
      return proofRequired(c);
    }
  }

  // An unknown key is registered exactly like the first sync PUT, charged
  // against the same global key capacity.
  if (existingKey === null) {
    const maxKeys = parseLimit(c.env.GLOBAL_MAX_KEYS, DEFAULT_MAX_KEYS);
    if ((await keysCreatedToday(c.env.DB, now)) >= maxKeys) {
      return apiError(
        c,
        429,
        "capacity_exceeded",
        "The global key capacity has been reached.",
      );
    }

    // OR IGNORE keeps two concurrent registrations from racing into a
    // unique-constraint error.
    const registered = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO keys (auth_id, key_hash, created_at, last_seen_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(authId, keyHash, now, now)
      .run();

    if ((registered.meta.changes ?? 0) > 0) {
      await recordKeyCreated(c.env.DB, now);
    } else {
      const racedKey = await loadKey(c.env.DB, authId);
      if (racedKey === null || !timingSafeEqual(racedKey.key_hash, keyHash)) {
        return invalidKey(c);
      }
    }
  }

  // First link, re-point at the proof-checked key, or a re-wrap of the same
  // key: only the vault columns change, never the password proof or salt.
  await c.env.DB.prepare(
    `UPDATE accounts SET auth_id = ?, wrapped_key = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(authId, wrappedKey, now, auth.account.id)
    .run();

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

accountsRoutes.post("/accounts/password", async (c) => {
  const auth = await authenticateAccount(c);
  if ("response" in auth) return auth.response;

  const body = await readJsonBody(c);
  if (body === null) return invalidRequest(c);

  const { oldAuthHash, newAuthHash, kdfSalt, kdfIterations, wrappedKey } = body;
  if (
    typeof oldAuthHash !== "string" ||
    !AUTH_HASH_PATTERN.test(oldAuthHash) ||
    typeof newAuthHash !== "string" ||
    !AUTH_HASH_PATTERN.test(newAuthHash)
  ) {
    return invalidRequest(c);
  }
  if (typeof kdfSalt !== "string" || !isValidSalt(kdfSalt)) {
    return invalidRequest(c);
  }
  if (!isValidIterations(kdfIterations)) return invalidRequest(c);
  if (!isNonEmptyString(wrappedKey)) return invalidRequest(c);

  if (
    !timingSafeEqual(
      auth.account.auth_hash,
      await sha256Hex(oldAuthHash),
    )
  ) {
    return proofRequired(c);
  }

  const now = Date.now();
  const { token, tokenHash } = await createToken();

  // The proof rotation, the revocation and the replacement token land
  // together, so a crash cannot leave the account with no usable token.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE accounts SET auth_hash = ?, kdf_salt = ?, kdf_iterations = ?,
              wrapped_key = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      await sha256Hex(newAuthHash),
      kdfSalt,
      kdfIterations,
      wrappedKey,
      now,
      auth.account.id,
    ),
    c.env.DB.prepare("DELETE FROM account_tokens WHERE account_id = ?").bind(
      auth.account.id,
    ),
    c.env.DB.prepare(
      `INSERT INTO account_tokens
         (token_hash, account_id, created_at, expires_at, last_used_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(tokenHash, auth.account.id, now, now + TOKEN_TTL_MS, now),
  ]);

  return c.json({ token });
});

// ---------------------------------------------------------------------------
// Recovery-key password reset
// ---------------------------------------------------------------------------

accountsRoutes.post("/accounts/recover", async (c) => {
  const body = await readJsonBody(c);
  if (body === null) return invalidRequest(c);

  const { email, authId, authKey, authHash, kdfSalt, kdfIterations, wrappedKey } =
    body;
  if (typeof email !== "string") return invalidRequest(c);
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail.length === 0) return invalidRequest(c);
  if (!isNonEmptyString(authId) || !isNonEmptyString(authKey)) {
    return invalidRequest(c);
  }
  if (typeof authHash !== "string" || !AUTH_HASH_PATTERN.test(authHash)) {
    return invalidRequest(c);
  }
  if (typeof kdfSalt !== "string" || !isValidSalt(kdfSalt)) {
    return invalidRequest(c);
  }
  if (!isValidIterations(kdfIterations)) return invalidRequest(c);
  if (!isNonEmptyString(wrappedKey)) return invalidRequest(c);

  const keyHash = await sha256Hex(authKey);
  const [key, account] = await Promise.all([
    loadKey(c.env.DB, authId),
    c.env.DB.prepare(
      "SELECT id, auth_id FROM accounts WHERE email = ?",
    )
      .bind(normalizedEmail)
      .first<{ id: string; auth_id: string | null }>(),
  ]);

  // Every failure answers the same 404 so recovery never reveals whether the
  // email, the authId or the key bearer was the part that did not match. The
  // comparison always runs against a full-length digest.
  const storedKeyHash = key?.key_hash ?? DUMMY_AUTH_HASH;
  const keyMatches = timingSafeEqual(storedKeyHash, keyHash);
  const accountMatches =
    account !== null &&
    account.auth_id !== null &&
    account.auth_id === authId;

  if (!keyMatches || !accountMatches) {
    return apiError(c, 404, "not_found", "Account not found.");
  }

  const now = Date.now();

  // The proof rotation and the token revocation land together.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE accounts SET auth_hash = ?, kdf_salt = ?, kdf_iterations = ?,
              wrapped_key = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      await sha256Hex(authHash),
      kdfSalt,
      kdfIterations,
      wrappedKey,
      now,
      account.id,
    ),
    c.env.DB.prepare("DELETE FROM account_tokens WHERE account_id = ?").bind(
      account.id,
    ),
  ]);

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Email reset for accounts without a vault
// ---------------------------------------------------------------------------

accountsRoutes.post("/accounts/reset-unlinked", async (c) => {
  const body = await readJsonBody(c);
  if (body === null) return invalidRequest(c);

  const { email, locale } = body;
  if (typeof email !== "string" || typeof locale !== "string") {
    return invalidRequest(c);
  }
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail.length === 0) return invalidRequest(c);

  // Only an account with no linked vault may reset by email; a linked
  // account's encrypted data is unreachable this way by construction.
  const account = await c.env.DB.prepare(
    "SELECT id FROM accounts WHERE email = ? AND auth_id IS NULL",
  )
    .bind(normalizedEmail)
    .first<{ id: string }>();

  if (account !== null) {
    const now = Date.now();
    const { token, tokenHash } = await createToken();
    await c.env.DB.prepare(
      `INSERT INTO email_verifications
         (token_hash, account_id, created_at, expires_at, used_at, purpose)
       VALUES (?, ?, ?, ?, NULL, 'reset')`,
    )
      .bind(tokenHash, account.id, now, now + RESET_TTL_MS)
      .run();

    const link = `${c.env.WEB_ORIGIN}/reset?token=${token}`;
    // Deliver after the response: an unknown address must not be measurably
    // faster than a real send, and a provider failure must not break the 202.
    c.executionCtx.waitUntil(
      sendEmail(c.env, {
        to: normalizedEmail,
        ...resetEmail(locale, link),
      }),
    );
  }

  // The response never discloses whether the address exists or has a vault.
  return c.json({ ok: true }, 202);
});

accountsRoutes.post("/accounts/reset-unlinked/confirm", async (c) => {
  const body = await readJsonBody(c);
  if (body === null) return invalidRequest(c);

  const { token, authHash, kdfSalt, kdfIterations } = body;
  if (!isNonEmptyString(token)) return invalidRequest(c);
  if (typeof authHash !== "string" || !AUTH_HASH_PATTERN.test(authHash)) {
    return invalidRequest(c);
  }
  if (typeof kdfSalt !== "string" || !isValidSalt(kdfSalt)) {
    return invalidRequest(c);
  }
  if (!isValidIterations(kdfIterations)) return invalidRequest(c);

  const now = Date.now();
  const tokenHash = await hashToken(token);

  // Claim the reset token only while the account still has no vault. The
  // predicate is repeated in the UPDATE so a concurrent link wins the race
  // and the reset can never reach encrypted data.
  const claimed = await c.env.DB.prepare(
    `UPDATE email_verifications SET used_at = ?
      WHERE token_hash = ? AND purpose = 'reset'
        AND used_at IS NULL AND expires_at > ?
        AND account_id IN (SELECT id FROM accounts WHERE auth_id IS NULL)
     RETURNING account_id`,
  )
    .bind(now, tokenHash, now)
    .first<{ account_id: string }>();

  if (claimed === null) return invalidToken(c);

  const updated = await c.env.DB.prepare(
    `UPDATE accounts SET auth_hash = ?, kdf_salt = ?, kdf_iterations = ?,
            email_verified_at = ?, updated_at = ?
      WHERE id = ? AND auth_id IS NULL`,
  )
    .bind(
      await sha256Hex(authHash),
      kdfSalt,
      kdfIterations,
      // Following the reset link proves mailbox control, so the account is
      // verified and the unverified-account cleanup can no longer sweep it.
      now,
      now,
      claimed.account_id,
    )
    .run();

  // A link that landed between the claim and the update burns the token but
  // must not rotate the proof; failing closed matches the vault rule.
  if ((updated.meta.changes ?? 0) === 0) return invalidToken(c);

  await c.env.DB.prepare("DELETE FROM account_tokens WHERE account_id = ?")
    .bind(claimed.account_id)
    .run();

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

accountsRoutes.delete("/accounts", async (c) => {
  const auth = await authenticateAccount(c);
  if ("response" in auth) return auth.response;

  const body = await readJsonBody(c);
  if (body === null) return invalidRequest(c);

  const { authHash } = body;
  if (typeof authHash !== "string" || !AUTH_HASH_PATTERN.test(authHash)) {
    return invalidRequest(c);
  }

  if (!timingSafeEqual(auth.account.auth_hash, await sha256Hex(authHash))) {
    return proofRequired(c);
  }

  // There is no FK cascade: tokens and verifications are removed explicitly.
  // Sync tables (keys, sessions, deletions) stay untouched by design.
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM account_tokens WHERE account_id = ?").bind(
      auth.account.id,
    ),
    c.env.DB.prepare(
      "DELETE FROM email_verifications WHERE account_id = ?",
    ).bind(auth.account.id),
    c.env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(
      auth.account.id,
    ),
  ]);

  return c.body(null, 204);
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Look up a registered sync key; null means the authId was never seen. */
function loadKey(db: D1Database, authId: string): Promise<KeyRow | null> {
  return db
    .prepare("SELECT key_hash FROM keys WHERE auth_id = ?")
    .bind(authId)
    .first<KeyRow>();
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
    "The link is invalid or has expired.",
  );
}

function proofRequired(c: AppContext) {
  return apiError(
    c,
    401,
    "proof_required",
    "The current password proof is required.",
  );
}

function invalidKey(c: AppContext) {
  return apiError(
    c,
    401,
    "unauthorized",
    "A valid sync key bearer is required.",
  );
}

function unauthorized(c: AppContext) {
  return apiError(c, 401, "unauthorized", "A valid account token is required.");
}
