# SaveTabs Accounts, Landing, and Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional end-to-end encrypted accounts with recovery keys, rebuild the web landing page, and support twelve locales including Arabic RTL.

**Architecture:** Accounts are a key vault, not a replacement for the sync key. The client stretches the password with PBKDF2-SHA256 (600k), derives an HMAC proof sent to the worker, and wraps the existing sync key with an AES-GCM key derived from the stretched password. The worker stores email, proof hash, KDF salt and wrapped key only. Sync keeps using key-derived bearers, so the existing sync path is untouched; accounts add new D1 tables and `/v1/accounts` routes.

**Tech Stack:** TypeScript, React 18, Vite, WXT, Hono, Cloudflare Workers, D1, Resend, Vitest, Cloudflare vitest pool.

**Spec:** `docs/superpowers/specs/2026-11-06-savetabs-accounts-landing-i18n-design.md`

## Global Constraints

- Node.js >= 22.12, pnpm 10.33; TypeScript strict, no `any` escapes in new code.
- E2EE invariants: the worker never receives the password, `masterKey`, sync key or `encKey`.
- KDF: PBKDF2-SHA256, **600000** iterations, **16-byte KDF salt derived from the normalized email** (first 16 bytes of `SHA-256("savetabs-kdf-v1:" + email)`), 32-byte output.
- `authHash = lowercase hex HMAC-SHA256(masterKey, "savetabs-auth-v1")`; the worker stores `SHA-256(authHash)` as lowercase hex.
- Vault: `wrapKey = HKDF-SHA256(masterKey, salt="savetabs-v1", info="vault-wrap")`; AES-GCM-256, 12-byte random IV, AAD `savetabs:vault:v1:<accountId>`, stored as `base64url(IV || ciphertext)`.
- Account tokens: 32 random bytes, base64url bearer, 30-day expiry, stored as lowercase hex SHA-256.
- Emails are normalized with `trim().toLowerCase()` before storage and lookup.
- Signup and unlinked-reset requests return the same generic response for new and existing addresses.
- No new extension permissions; manifest stays `tabs`, `storage`, `alarms`, `contextMenus` and the single API host permission.
- Web app CSP stays same-origin scripts; no third-party scripts or fonts.
- Account endpoints reuse the existing error envelope and the IP rate limiter; login/signup also use `RATE_LIMITER_AUTH` with key `email:<normalized email>` and Resend sends are capped at 5/day/account.
- Every UI string exists for all twelve locales; English remains authoritative; the privacy page renders English for every locale and states that the English text prevails.
- Every UI task adds its new keys to `en.json` and `vi.json` in the same task; later locale work translates from that source.
- Conventional commits, no AI attribution lines.

## Review Focus

1. **Signup on a device that already has a key must link that key** — never create an empty vault while a local key exists. Test in Task 13 (`linkDeviceKey` uses the existing key and its displayed form).
2. **Login with a different vault key must not delete local sessions** — replace the device key, ask about uploading local sessions, and keep them local-only when declined. Test in Task 13.
3. **Key changes are atomic with re-link** — rotation/import must fail closed when the account re-link fails; the old key and account stay intact. Tests in Task 13 and Task 7.
4. **Account enumeration** — signup/reset for an existing email returns the same 202 body as a new address, and login failures are indistinguishable. Tests in Tasks 5 and 7.
5. **Arabic RTL** — `dir="rtl"` renders, and the web landing page does not scroll horizontally at 360px with `ar` selected; the extension popup/options RTL check is manual with the store screenshot harness. Automated test in Task 16.

---

## File Structure

```
packages/shared/src/
  account/kdf.ts            password stretching, auth proof, wrap key
  account/vault.ts          wrap/unwrap the sync key
  account/kdf.test.ts
  account/vault.test.ts
  api/account-client.ts     typed HTTP client for /v1/accounts
  api/account-client.test.ts
  i18n/locales.ts           locale registry (code, native name, direction)
  i18n/zh-CN.json … ko.json ten new dictionaries
apps/worker/
  migrations/0002_accounts.sql
  src/accounts/tokens.ts    token creation/hash, email normalization
  src/accounts/email.ts     Resend sender + verification email copy
  src/routes/accounts.ts    /v1/accounts routes
  src/index.ts              route wiring + scheduled cleanup
  src/env.ts                RESEND_API_KEY, RESEND_FROM, RATE_LIMITER_EMAIL
  test/accounts.test.ts
  test/accounts-email.test.ts
  test/accounts-cleanup.test.ts
apps/web/src/
  lib/account-session.ts    token storage + account client factory
  pages/Signup.tsx / Login.tsx / Verify.tsx / Account.tsx
  components/UnlockGate.tsx
  pages/Landing.tsx         redesign
apps/extension/
  lib/account-session.ts    token storage, sign in/up, unwrap, link
  components/AccountCard.tsx
  components/RecoveryKeyDialog.tsx
  components/SyncSection.tsx
```

---

### Task 1: Shared KDF and vault primitives

**Files:**
- Create: `packages/shared/src/account/kdf.ts`, `packages/shared/src/account/vault.ts`, `packages/shared/src/account/kdf.test.ts`, `packages/shared/src/account/vault.test.ts`
- Modify: `packages/shared/src/index.ts` (export the new modules)

**Interfaces:**
- Produces: `KDF_ITERATIONS = 600000`, `KDF_SALT_BYTES = 16`, `randomKdfSalt(): Uint8Array`, `encodeSalt(raw: Uint8Array): string`, `decodeSalt(value: string): Uint8Array`, `deriveMasterKey(password: string, salt: Uint8Array, iterations?: number): Promise<Uint8Array>`, `deriveAuthHash(masterKey: Uint8Array): Promise<string>`, `deriveWrapKey(masterKey: Uint8Array): Promise<CryptoKey>`, `wrapSyncKey(wrapKey: CryptoKey, rawKey: Uint8Array, accountId: string): Promise<string>`, `unwrapSyncKey(wrapKey: CryptoKey, wrapped: string, accountId: string): Promise<Uint8Array>`.

- [ ] **Step 1: Write the failing tests**

```ts
// kdf.test.ts
const PASSWORD = "correct horse battery staple";
const SALT = Uint8Array.from({ length: 16 }, (_, i) => i);

it("stretches the password with PBKDF2-SHA256", async () => {
  const masterKey = await deriveMasterKey(PASSWORD, SALT, 1000);
  expect(Buffer.from(masterKey).toString("hex")).toBe(
    "a69b179e3add3c1e0aaf227a0eb3aa2aa8645ab86fecf6ca00c17512697c719e",
  );
});

it("derives the authentication proof", async () => {
  const masterKey = Uint8Array.from({ length: 32 }, (_, i) => i);
  expect(await deriveAuthHash(masterKey)).toBe(
    "e07b4f63abd5a633d8a3f4346b8f99642025b577ac400d2f19240aad665b7599",
  );
});
```

```ts
// vault.test.ts
it("round-trips the sync key", async () => {
  const masterKey = new Uint8Array(32).fill(7);
  const wrapKey = await deriveWrapKey(masterKey);
  const rawKey = new Uint8Array(16).fill(3);
  const wrapped = await wrapSyncKey(wrapKey, rawKey, "acc-1");
  expect(await unwrapSyncKey(wrapKey, wrapped, "acc-1")).toEqual(rawKey);
});

it("rejects a different account AAD", async () => {
  const wrapKey = await deriveWrapKey(new Uint8Array(32).fill(7));
  const wrapped = await wrapSyncKey(wrapKey, new Uint8Array(16), "acc-1");
  await expect(unwrapSyncKey(wrapKey, wrapped, "acc-2")).rejects.toThrow();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @savetabs/shared test -- kdf vault`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the modules**

`deriveMasterKey` uses `crypto.subtle.importKey("raw", TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"])` then `deriveBits({name:"PBKDF2", hash:"SHA-256", salt, iterations}, key, 256)`. `deriveAuthHash` imports the 32-byte key as HMAC-SHA-256 and signs the UTF-8 string `savetabs-auth-v1`, returning `toLowerCase()` hex. `deriveWrapKey` HKDFs with salt UTF-8 `savetabs-v1` and info UTF-8 `vault-wrap` into a non-extractable AES-GCM key. `wrapSyncKey` creates a random 12-byte IV, encrypts with `additionalData` = UTF-8 `savetabs:vault:v1:${accountId}`, and returns `toBase64Url(concat(iv, ciphertext))`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @savetabs/shared test`
Expected: PASS, including the existing suites.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/account packages/shared/src/index.ts
git commit -m "feat(shared): add account KDF and vault primitives"
```

---

### Task 2: Shared account HTTP client

**Files:**
- Create: `packages/shared/src/api/account-client.ts`, `packages/shared/src/api/account-client.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./api/account-client";`)

**Interfaces:**
- Produces: `AccountProfile = { id: string; email: string; emailVerified: boolean; authId: string | null; locale: Lang }`, `AccountVault = { wrappedKey: string; kdfSalt: string; kdfIterations: number; authId: string }`, `LoginResult = { token: string; account: AccountProfile; vault: AccountVault | null }`, `AccountApiError` with `status` and `code`, and `AccountClient` with `signup`, `login`, `logout`, `me`, `verifyEmail`, `resendVerification`, `linkKey`, `changePassword`, `recover`, `requestUnlinkedReset`, `confirmUnlinkedReset`, `deleteAccount`.
- Consumes: `toBase64Url`/`fromBase64Url`; mirror `SyncClient`'s trailing-slash normalization and `.call(globalThis, ...)` fetch binding.

- [ ] **Step 1: Write the failing test**

```ts
it("posts signup and returns the generic response", async () => {
  const calls: RequestInit[] = [];
  const client = new AccountClient("https://api.test", async (url, init) => {
    calls.push(init!);
    return new Response(JSON.stringify({ ok: true }), { status: 202 });
  });
  await client.signup({
    email: "a@example.com",
    authHash: "ab".repeat(32),
    kdfSalt: "AAAA",
    kdfIterations: 600000,
    locale: "en",
  });
  expect(calls[0]?.method).toBe("POST");
});

it("maps an error envelope to AccountApiError", async () => {
  const client = new AccountClient("https://api.test", async () =>
    new Response(JSON.stringify({ error: { code: "invalid_credentials", message: "no" } }), { status: 401 }),
  );
  await expect(client.login({ email: "a@b.c", authHash: "ab".repeat(32) }))
    .rejects.toMatchObject({ status: 401, code: "invalid_credentials" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @savetabs/shared test -- account-client`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AccountClient`**

Every method calls a private `request<T>(path, init)` that sets `Content-Type: application/json`, attaches `Authorization: Bearer <token>` when given, parses the existing `{error:{code,message}}` envelope into `AccountApiError`, and returns parsed JSON (204 → `undefined`). Route shapes follow the spec's API table.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @savetabs/shared test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/api/account-client.ts packages/shared/src/api/account-client.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add the account API client"
```

---

### Task 3: D1 migration for accounts

**Files:**
- Create: `apps/worker/migrations/0002_accounts.sql`

**Interfaces:**
- Produces: tables `accounts`, `account_tokens`, `email_verifications` with the exact columns from the spec, plus indexes on `account_tokens.account_id` and `email_verifications.account_id`.

- [ ] **Step 1: Write the migration**

Copy the three `CREATE TABLE` statements from the spec verbatim; add `CREATE INDEX idx_account_tokens_account ON account_tokens (account_id);` and `CREATE INDEX idx_email_verifications_account ON email_verifications (account_id);`.

- [ ] **Step 2: Apply it locally**

Run: `pnpm --filter @savetabs/worker db:migrate:local`
Expected: migration `0002_accounts.sql` applied.

- [ ] **Step 3: Run the worker suite**

Run: `pnpm --filter @savetabs/worker test`
Expected: PASS (migrations are read by the test setup).

- [ ] **Step 4: Commit**

```bash
git add apps/worker/migrations/0002_accounts.sql
git commit -m "feat(worker): add account tables"
```

---

### Task 4: Worker account helpers, email sender, and rate-limit binding

**Files:**
- Create: `apps/worker/src/accounts/tokens.ts`, `apps/worker/src/accounts/email.ts`, `apps/worker/test/accounts-email.test.ts`
- Modify: `apps/worker/src/auth.ts` (export `parseBearer`), `apps/worker/src/routes/sessions.ts` (import the shared `parseBearer`), `apps/worker/src/env.ts`, `apps/worker/wrangler.toml`

**Interfaces:**
- Produces: `normalizeEmail(value: string): string`, `createToken(): { token: string; tokenHash: string }`, `hashToken(token: string): Promise<string>`, `sendEmail(env, message, fetchImpl?): Promise<void>`, `verificationEmail(locale: string, link: string): { subject: string; html: string; text: string }`.
- Consumes: `sha256Hex` from `../auth`; `RESEND_API_KEY`, `RESEND_FROM` from `Env`.

- [ ] **Step 1: Write the failing test**

```ts
it("sends through Resend with the bearer secret", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  await sendEmail(
    {
      RESEND_API_KEY: "re_test",
      RESEND_FROM: "SaveTabs <noreply@azcom.dev>",
    } as Env,
    { to: "a@example.com", subject: "S", html: "<p>h</p>", text: "t" },
    async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return new Response("{}", { status: 200 });
    },
  );
  expect(calls[0]?.url).toBe("https://api.resend.com/emails");
  expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
});

it("skips sending when the key is absent", async () => {
  await expect(
    sendEmail({ RESEND_FROM: "x" } as Env, { to: "a@b.c", subject: "s", html: "h", text: "t" }, async () => {
      throw new Error("must not be called");
    }),
  ).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @savetabs/worker test -- accounts-email`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`createToken` uses 32 random bytes from `crypto.getRandomValues` and `toBase64Url`. `hashToken` returns `sha256Hex(token)`. `sendEmail` returns early when `RESEND_API_KEY` is missing, otherwise posts `{from: env.RESEND_FROM ?? "SaveTabs <noreply@azcom.dev>", to, subject, html, text}`. Add `RESEND_API_KEY?: string`, `RESEND_FROM?: string`, `RATE_LIMITER_EMAIL?: RateLimiterBinding` to `Env`; add the `RATE_LIMITER_EMAIL` binding (namespace `1003`, limit `5`, period `60`) to `wrangler.toml` and the `RESEND_FROM` var.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @savetabs/worker test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/accounts apps/worker/src/auth.ts apps/worker/src/routes/sessions.ts apps/worker/src/env.ts apps/worker/wrangler.toml apps/worker/test/accounts-email.test.ts
git commit -m "feat(worker): add account token helpers and the Resend sender"
```

---

### Task 5: Signup, login, logout, and profile routes

**Files:**
- Create: `apps/worker/src/routes/accounts.ts`, `apps/worker/test/accounts.test.ts`
- Modify: `apps/worker/src/index.ts` (register the route)

**Interfaces:**
- Produces: `POST /v1/accounts/signup` → `202 { ok: true }` for new and existing emails; `POST /v1/accounts/login` → `{ token, account, vault }`; `POST /v1/accounts/logout`; `GET /v1/accounts/me`.
- Consumes: `normalizeEmail`, `createToken`, `hashToken`, `sendEmail`, `verificationEmail` from Task 4; `sha256Hex`/`timingSafeEqual`.

- [ ] **Step 1: Write the failing tests**

```ts
it("creates an account and returns the same body for a duplicate email", async () => {
  const first = await post("/v1/accounts/signup", {
    email: "New@Example.com ",
    authHash: "ab".repeat(32),
    kdfSalt: "AAAA",
    kdfIterations: 600000,
    locale: "en",
  });
  const second = await post("/v1/accounts/signup", { /* same email */ });
  expect(first.status).toBe(202);
  expect(await first.json()).toEqual(await second.json());
});

it("returns a token and the vault on login", async () => {
  const res = await post("/v1/accounts/login", {
    email: "new@example.com",
    authHash: "ab".repeat(32),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(typeof body.token).toBe("string");
  expect(body.account.email).toBe("new@example.com");
});

it("does not distinguish unknown emails on login", async () => {
  const res = await post("/v1/accounts/login", { email: "nobody@example.com", authHash: "ab".repeat(32) });
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: { code: "invalid_credentials" } });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @savetabs/worker test -- accounts`
Expected: FAIL — 404 route.

- [ ] **Step 3: Implement the routes**

Signup validates `authHash` is 64 lowercase hex chars, `kdfSalt` decodes to 16 bytes, and `kdfIterations` is an integer in `[100000, 2000000]`; it upserts nothing when the email exists, but always creates a verification token for new accounts and sends the email; duplicate emails receive a generic verification notice instead. Login hashes the supplied `authHash` with `sha256Hex` and compares in constant time; on a missing account it still hashes and compares against a fixed dummy value before returning `401 invalid_credentials`. Tokens expire after 30 days. `me` returns the profile without salts.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @savetabs/worker test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/accounts.ts apps/worker/src/index.ts apps/worker/test/accounts.test.ts
git commit -m "feat(worker): add account signup, login, and profile routes"
```

---

### Task 6: Email verification and resend routes

**Files:**
- Modify: `apps/worker/src/routes/accounts.ts`, `apps/worker/test/accounts.test.ts`

**Interfaces:**
- Produces: `POST /v1/accounts/verify-email` `{ token }` → `{ verified: true }` or `410 invalid_token`; `POST /v1/accounts/resend-verification` (token auth) → `202 { ok: true }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("verifies a token once", async () => {
  const token = await latestVerificationToken();
  expect((await post("/v1/accounts/verify-email", { token })).status).toBe(200);
  expect((await post("/v1/accounts/verify-email", { token })).status).toBe(410);
});

it("resends only for signed-in accounts", async () => {
  expect((await post("/v1/accounts/resend-verification", {})).status).toBe(401);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @savetabs/worker test -- accounts`
Expected: FAIL — route missing.

- [ ] **Step 3: Implement**

Verification tokens are single-use, 24-hour, `purpose = 'verify'`; success sets `email_verified_at`. Resend requires a valid account token, creates a fresh token, and returns `202` regardless of the current verification state.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @savetabs/worker test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/accounts.ts apps/worker/test/accounts.test.ts
git commit -m "feat(worker): verify account email addresses"
```

---

### Task 7: Key linking, password change, recovery, unlinked reset, deletion

**Files:**
- Modify: `apps/worker/src/routes/accounts.ts`, `apps/worker/test/accounts.test.ts`

**Interfaces:**
- Produces: `POST /v1/accounts/key` `{ authId, authKey, wrappedKey, authHash, replace? }`; `POST /v1/accounts/password` `{ oldAuthHash, newAuthHash, kdfSalt, kdfIterations, wrappedKey }` → `{ token }`; `POST /v1/accounts/recover` `{ email, authId, authKey, authHash, kdfSalt, kdfIterations, wrappedKey }`; `POST /v1/accounts/reset-unlinked` `{ email, locale }`; `POST /v1/accounts/reset-unlinked/confirm` `{ token, authHash, kdfSalt, kdfIterations }`; `DELETE /v1/accounts` `{ authHash }` → `204`.

- [ ] **Step 1: Write the failing tests**

```ts
it("links once, then requires proof and replace to repoint", async () => {
  expect((await linkKey(accountToken, keyA, wrappedKeyA, authHash)).status).toBe(200);
  expect((await linkKey(accountToken, keyB, wrappedKeyB, authHash)).status).toBe(409);
  expect((await linkKey(accountToken, keyB, wrappedKeyB, authHash, { replace: true })).status).toBe(200);
});

it("rejects recovery when the key does not own the account", async () => {
  expect((await post("/v1/accounts/recover", recoveryBodyFor(keyB))).status).toBe(404);
});

it("never resets an account that has a vault", async () => {
  await post("/v1/accounts/reset-unlinked", { email: "new@example.com", locale: "en" });
  const tokens = await resetTokensFor("new@example.com");
  expect(tokens).toHaveLength(0);
});

it("deletes the account without touching sync data", async () => {
  expect((await del("/v1/accounts", { authHash })).status).toBe(204);
  expect(await keyRowExists(authId)).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @savetabs/worker test -- accounts`
Expected: FAIL — routes missing.

- [ ] **Step 3: Implement the rules from the spec**

`key`: verify the bearer against `keys.key_hash`, registering the key with `INSERT OR IGNORE` when absent; first link sets `auth_id`/`wrapped_key`; an existing link with a different `authId` returns `409 vault_exists` unless `replace: true` and the `authHash` proof matches. A taken `authId` returns `409 auth_id_taken`. `password`: proof of the current password required, then update hash/salt/wrapped key, delete all tokens and return a fresh one. `recover`: bearer must match the key row, and `email`/`auth_id` must match the account; updates proof + vault and revokes tokens. `reset-unlinked`: only creates a `purpose='reset'` token when `auth_id IS NULL`; always returns `202`. `delete`: proof required; delete tokens, verifications and the account; leave sync tables untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @savetabs/worker test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/accounts.ts apps/worker/test/accounts.test.ts
git commit -m "feat(worker): link keys and recover accounts"
```

---

### Task 8: Cleanup schedule and endpoint limits

**Files:**
- Modify: `apps/worker/src/index.ts`, `apps/worker/wrangler.toml`, `apps/worker/src/routes/accounts.ts`
- Create: `apps/worker/src/accounts/cleanup.ts`, `apps/worker/test/accounts-cleanup.test.ts`

**Interfaces:**
- Produces: `cleanupUnverifiedAccounts(db: D1Database, now?: number): Promise<number>` deleting accounts with `email_verified_at IS NULL AND auth_id IS NULL AND created_at < now - 30 days` plus their tokens/verifications; the scheduled handler calls it; account endpoints charge `RATE_LIMITER_EMAIL` with `email:<normalized email>` for signup and reset requests.

- [ ] **Step 1: Write the failing test**

```ts
it("removes only old unverified unlinked accounts", async () => {
  const old = await seedAccount({ verified: false, linked: false, ageDays: 31 });
  const fresh = await seedAccount({ verified: false, linked: false, ageDays: 1 });
  const linked = await seedAccount({ verified: false, linked: true, ageDays: 31 });
  await cleanupUnverifiedAccounts(env.DB);
  expect(await accountExists(old.id)).toBe(false);
  expect(await accountExists(fresh.id)).toBe(true);
  expect(await accountExists(linked.id)).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @savetabs/worker test -- accounts-cleanup`
Expected: FAIL — cleanup not exported.

- [ ] **Step 3: Implement**

Call `cleanupUnverifiedAccounts` from the default export's `scheduled` and add `[triggers] crons = ["17 3 * * *"]` to `wrangler.toml`. Wire the email limiter before inserting signup/reset rows.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @savetabs/worker test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/accounts apps/worker/src/routes/accounts.ts apps/worker/wrangler.toml apps/worker/test/accounts-cleanup.test.ts
git commit -m "feat(worker): expire unverified accounts and limit account requests"
```

---

### Task 9: Web signup page

**Files:**
- Create: `apps/web/src/lib/account-session.ts`, `apps/web/src/pages/Signup.tsx`, `apps/web/src/pages/Signup.test.tsx`
- Modify: `apps/web/src/App.tsx` (route `/signup`)

**Interfaces:**
- Produces: `ACCOUNT_TOKEN_STORAGE_KEY = "savetabs.account-token"`, `saveAccountToken(token)`, `loadAccountToken(): string | null`, `clearAccountToken()`, `createAccountClient(): AccountClient`.
- Consumes: Task 1 KDF, Task 2 client, `formatKey`/`generateKey` from shared.

- [ ] **Step 1: Write the failing test**

```tsx
it("signs up, derives the key, and stores a token", async () => {
  renderApp("/signup");
  await user.type(screen.getByLabelText("Email"), "a@example.com");
  await user.type(screen.getByLabelText("Password"), "a-long-password-123");
  await user.type(screen.getByLabelText("Confirm password"), "a-long-password-123");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByText(/recovery key/i)).toBeInTheDocument();
  expect(loadAccountToken()).not.toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @savetabs/web test -- Signup`
Expected: FAIL — route/page missing.

- [ ] **Step 3: Implement**

The form derives `masterKey`/`authHash` with a submitting state, calls `signup`, then `login`, then links the device key. On a device with an existing key, wrap that key; otherwise generate one. Show the recovery key dialog with a required checkbox before navigating to `/sessions`. Minimum password length 12; mismatched confirmation blocks submit.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @savetabs/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/account-session.ts apps/web/src/pages/Signup.tsx apps/web/src/pages/Signup.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): add account signup"
```

---

### Task 10: Web login, recovery, and verification pages

**Files:**
- Create: `apps/web/src/pages/Login.tsx`, `apps/web/src/pages/Login.test.tsx`, `apps/web/src/pages/Verify.tsx`, `apps/web/src/pages/Verify.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces: routes `/login`, `/verify`; login stores the token, unwraps the vault and calls `saveKeyForSession` with the remember toggle; "Use recovery key" submits `recover` and then logs in.

- [ ] **Step 1: Write the failing tests**

```tsx
it("logs in and stores the unwrapped key", async () => {
  renderApp("/login");
  /* type email + password, submit */
  expect(await screen.findByText(/saved sessions/i)).toBeInTheDocument();
  expect(loadKey()).not.toBeNull();
});

it("shows a verification result from the link token", async () => {
  renderApp("/verify?token=abc");
  expect(await screen.findByText(/verified/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @savetabs/web test -- Login Verify`
Expected: FAIL — routes missing.

- [ ] **Step 3: Implement**

Login derives the key from the password + returned salt, unwraps the vault, and follows `saveKeyForSession(key, remember)`. Recovery form takes email, recovery key and new password, calls `recover`, then logs in. Verify consumes `?token=` and renders success/expired states; it never requires a key.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @savetabs/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/Login.tsx apps/web/src/pages/Login.test.tsx apps/web/src/pages/Verify.tsx apps/web/src/pages/Verify.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): add login, recovery, and email verification"
```

---

### Task 11: Web account page and session unlock

**Files:**
- Create: `apps/web/src/pages/Account.tsx`, `apps/web/src/pages/Account.test.tsx`, `apps/web/src/components/UnlockGate.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/pages/Sessions.tsx` (render unlock gate when a token exists but no key)

**Interfaces:**
- Produces: `/account` page showing email, verification banner with resend, change password, view recovery key (re-enter password), logout, delete account with optional cloud-data deletion; `UnlockGate` with `onUnlocked(key: string, remember: boolean)`.

- [ ] **Step 1: Write the failing test**

```tsx
it("unlocks a stored session with the password", async () => {
  saveAccountToken("token");
  renderApp("/sessions");
  await user.type(screen.getByLabelText("Password"), "a-long-password-123");
  await user.click(screen.getByRole("button", { name: "Unlock" }));
  expect(await screen.findByRole("heading", { name: "Saved sessions" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @savetabs/web test -- Account Unlock`
Expected: FAIL — components missing.

- [ ] **Step 3: Implement**

Account actions call the Task 2 client; password change re-wraps and replaces the token; delete requires the password and offers "also delete cloud data" through the existing `SyncClient.deleteAll()`. `UnlockGate` re-runs login and unwraps without exposing the key in the URL.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @savetabs/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/Account.tsx apps/web/src/pages/Account.test.tsx apps/web/src/components/UnlockGate.tsx apps/web/src/App.tsx apps/web/src/pages/Sessions.tsx
git commit -m "feat(web): add the account page and session unlock"
```

---

### Task 12: Extension account card (sign up, sign in, sign out)

**Files:**
- Create: `apps/extension/lib/account-session.ts`, `apps/extension/components/AccountCard.tsx`, `apps/extension/components/AccountCard.test.tsx`
- Modify: `apps/extension/components/SyncSection.tsx`

**Interfaces:**
- Produces: `EXTENSION_ACCOUNT_TOKEN_KEY = "accountToken"`, `signIn(email, password): Promise<void>`, `signUp(email, password): Promise<void>`, `signOut(): Promise<void>`, `getAccount(): Promise<AccountProfile | null>`.
- Consumes: Task 1 KDF, Task 2 client, `getKey`/`setKey` from `lib/sync/key-store`.

- [ ] **Step 1: Write the failing test**

```tsx
it("signs in and keeps the local sync key on sign-out", async () => {
  await seedKey();
  render(<AccountCard t={t} />);
  await user.type(screen.getByLabelText("Email"), "a@example.com");
  await user.type(screen.getByLabelText("Password"), "a-long-password-123");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await user.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(await getKey()).toBeDefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @savetabs/extension test -- AccountCard`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement**

The card renders signed-out (email/password, "Create account", "Use a key instead") and signed-in (email, verification badge, sign out, change password) states. Token storage uses `browser.storage.local`. Sign-in calls `login`, unwraps the vault and calls `setKey` with rebind mode `upload` (Task 13). Sign-out removes the token only.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @savetabs/extension test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/lib/account-session.ts apps/extension/components/AccountCard.tsx apps/extension/components/AccountCard.test.tsx apps/extension/components/SyncSection.tsx
git commit -m "feat(extension): add the account card"
```

---

### Task 13: Extension key reconciliation and recovery dialog

**Files:**
- Modify: `apps/extension/lib/account-session.ts`, `apps/extension/components/AccountCard.tsx`, `apps/extension/components/SyncSection.tsx`, `apps/extension/lib/sync/sync-lifecycle.ts`
- Create: `apps/extension/components/RecoveryKeyDialog.tsx`, `apps/extension/lib/account-session.test.ts`

**Interfaces:**
- Produces: `linkDeviceKey(profile, vault, password): Promise<void>` that links the existing key when the account has no vault, adopts the account vault on mismatch (prompting about local sessions), and shows the recovery key once. `reLinkAfterKeyChange(newKey, password): Promise<void>` used by rotate/import.

- [ ] **Step 1: Write the failing tests**

```ts
it("links the existing device key instead of creating a vault", async () => {
  await setKey(existingKey);
  await linkDeviceKey(profileWithoutVault, null, password);
  expect(await getKey()).toBe(existingKey);
  expect(lastLinkBody().wrappedKey).toBeDefined();
});

it("adopts the account vault and asks before uploading local sessions", async () => {
  await setKey(deviceKey);
  await linkDeviceKey(profileWithVault, vault, password);
  expect(await getKey()).toBe(accountKey);
  expect(confirmUploadPrompt).toHaveBeenCalled();
});

it("aborts rotation when re-link fails", async () => {
  await expect(rotateAndRelink(failingLink)).rejects.toThrow();
  expect(await getKey()).toBe(oldKey);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @savetabs/extension test -- account-session`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Rules from the spec: no silent vault replacement; adopting a different key keeps local sessions and asks about upload; rotate/import re-wrap + `linkKey(..., { replace: true })` before deleting old cloud data; on failure restore the old key. The recovery dialog requires an explicit checkbox before dismissal.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @savetabs/extension test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/lib/account-session.ts apps/extension/lib/account-session.test.ts apps/extension/components/AccountCard.tsx apps/extension/components/RecoveryKeyDialog.tsx apps/extension/components/SyncSection.tsx apps/extension/lib/sync/sync-lifecycle.ts
git commit -m "feat(extension): reconcile keys with accounts"
```

---

### Task 14: Landing page redesign

**Files:**
- Modify: `apps/web/src/pages/Landing.tsx`, `apps/web/src/pages/Landing.test.tsx`
- Create: `apps/web/src/components/landing/*.tsx` (`Hero`, `HowItWorks`, `PrivacySection`, `FeatureGrid`, `AccountCta`, `InstallHelp`, `SiteFooter`)

**Interfaces:**
- Produces: the sections and order from the spec; account CTA links `/signup` and `/login`; key entry stays as a secondary path; download buttons use the store URLs; no numeric memory claims.

- [ ] **Step 1: Write the failing tests**

```tsx
it("renders the marketing sections and account actions", () => {
  renderApp("/");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/save every tab/i);
  expect(screen.getByRole("link", { name: /add to chrome/i })).toHaveAttribute("href", expect.stringContaining("chromewebstore"));
  expect(screen.getByRole("link", { name: /create account/i })).toHaveAttribute("href", "/signup");
  expect(screen.getByText(/end-to-end encrypted/i)).toBeInTheDocument();
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
});

it("keeps the key path available", () => {
  renderApp("/");
  expect(screen.getByLabelText(/sync key/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @savetabs/web test -- Landing`
Expected: FAIL — sections missing.

- [ ] **Step 3: Implement**

Build the sections as small components; reuse the existing theme/language controls in the header; Firefox button is disabled with a "coming soon" label until AMO publishes. All strings come from the dictionary (`web.landing.*`), added to en/vi now.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @savetabs/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/Landing.tsx apps/web/src/pages/Landing.test.tsx apps/web/src/components/landing
git commit -m "feat(web): rebuild the landing page"
```

---

### Task 15: Ten new locales and the locale registry

**Files:**
- Create: `packages/shared/src/i18n/locales.ts`, `packages/shared/src/i18n/{zh-CN,es,hi,ar,pt,ru,ja,fr,de,ko}.json`
- Modify: `packages/shared/src/i18n/index.ts`, `packages/shared/src/i18n/i18n.test.ts`, `packages/shared/src/settings-schema.ts`

**Interfaces:**
- Produces: `Lang` becomes the union of twelve codes; `LOCALES: readonly Locale[]` with `{ code, name, dir }`; `resolveLang` maps `zh*` → `zh-CN`, `pt*` → `pt`, `es*` → `es`, `hi*` → `hi`, `ar*` → `ar`, `ru*` → `ru`, `ja*` → `ja`, `fr*` → `fr`, `de*` → `de`, `ko*` → `ko`, `vi*` → `vi`, else `en`; `general.language` values become `["auto", ...langs]`.

- [ ] **Step 1: Write the failing tests**

```ts
it("has every English key in every locale", () => {
  for (const locale of LANGS) {
    expect(missingKeys(locale, ALL_EN_KEYS), locale).toEqual([]);
  }
});

it("resolves browser language prefixes", () => {
  expect(resolveLang("auto", "zh-TW")).toBe("zh-CN");
  expect(resolveLang("auto", "pt-BR")).toBe("pt");
  expect(resolveLang("auto", "ar-EG")).toBe("ar");
  expect(resolveLang("auto", "xx")).toBe("en");
});

it("marks Arabic as RTL", () => {
  expect(LOCALES.find((l) => l.code === "ar")?.dir).toBe("rtl");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @savetabs/shared test -- i18n`
Expected: FAIL — locales missing.

- [ ] **Step 3: Implement and translate**

Create the registry and extend `Lang`. Translate every key from `en.json` into the ten locales, preserving `{placeholders}`, brand names and URLs. `web.privacy.*` keys are translated for `en`/`vi` only; the parity test exempts those keys for the new locales because the policy page renders English. Update the settings schema language enum from the registry.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @savetabs/shared test && pnpm --filter @savetabs/extension typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/i18n packages/shared/src/settings-schema.ts
git commit -m "feat(i18n): add ten locales and the locale registry"
```

---

### Task 16: Language menus and Arabic RTL

**Files:**
- Modify: `apps/web/src/hooks/useI18n.ts`, `apps/web/src/pages/Landing.tsx`, `apps/web/src/pages/Privacy.tsx`, `apps/extension/entrypoints/options/App.tsx` (if the enum renders custom), `packages/shared/src/i18n/index.ts` (direction helper), `apps/web/e2e/web.spec.ts`
- Test: `apps/web/src/hooks/useI18n.test.tsx`, `apps/web/e2e/web.spec.ts`

**Interfaces:**
- Produces: `localeDir(lang): "ltr" | "rtl"`; the document sets `dir` and `lang` whenever the locale changes; the web header renders a select of all locales (native names); the privacy page always uses `createTranslator("en")`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("sets dir=rtl for Arabic", () => {
  renderApp("/");
  userEvent.selectOptions(screen.getByLabelText(/language/i), "ar");
  expect(document.documentElement.dir).toBe("rtl");
});

it("renders the privacy policy in English for Arabic", () => {
  renderApp("/privacy");
  /* select ar */
  expect(screen.getByText(/What the sync server stores/)).toBeInTheDocument();
});
```

```ts
// apps/web/e2e/web.spec.ts
test("Arabic stays within a 360px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.getByLabel(/language/i).selectOption("ar");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @savetabs/web test -- i18n`
Expected: FAIL.

- [ ] **Step 3: Implement and audit RTL**

Replace the two-way toggle with a labeled select; set `dir` from the registry. Convert physical utilities to logical ones (`pl/ pr/ ml/ mr/ left/ right` → `ps/ pe/ ms/ me/ start/ end`) where present in web and extension components, and mirror directional icons with `rtl:rotate-180`. The privacy page pins English and shows the "English version prevails" note.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @savetabs/web test && pnpm --filter @savetabs/extension test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks apps/web/src/pages apps/extension/entrypoints apps/extension/components packages/shared/src/i18n/index.ts
git commit -m "feat(i18n): add language selection and RTL support"
```

---

### Task 17: Privacy policy, store copy, and data declarations

**Files:**
- Modify: `packages/shared/src/i18n/en.json`, `packages/shared/src/i18n/vi.json`, `apps/extension/store/description.md`, `apps/extension/store/privacy-notes.md`, `apps/extension/store/permissions.md`, `apps/extension/wxt.config.ts`, `README.md`

**Interfaces:**
- Produces: policy text covering email, the password-derived proof, wrapped key, tokens, Resend as processor, recovery-key limitation; store copy says "No account needed"; Chrome data usage adds PII + Authentication information; AMO declaration adds `personallyIdentifyingInfo` and `authenticationInfo`.

- [ ] **Step 1: Write the failing test**

```ts
it("documents every account data field in the privacy copy", () => {
  for (const key of ["accountEmail", "accountProof", "accountVault", "accountTokens", "processorResend", "recoveryLimit"]) {
    expect(missingKeys("en", [`web.privacy.account.${key}`])).toEqual([]);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @savetabs/shared test -- i18n`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the privacy keys and copy (English authoritative, Vietnamese translation kept), update store descriptions and reviewer notes, and change the Firefox manifest declaration to `required: ["none"]`, optional `["browsingActivity", "authenticationInfo", "personallyIdentifyingInfo", "technicalAndInteraction"]`. Update `verify-build.mjs` only if the shape changes (it already checks the key exists).

- [ ] **Step 4: Run the full suite**

Run: `pnpm test && pnpm typecheck && pnpm verify:build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/i18n apps/extension/store apps/extension/wxt.config.ts README.md
git commit -m "docs: describe account data in the privacy policy and store listings"
```

---

## Self-review

- Spec coverage: accounts (Tasks 1–13), landing (Task 14), localization (Tasks 15–16), privacy/store updates (Task 17). Every spec section maps to a task; the recovery email templates are localized in Task 15 via `locale`, and the worker's `verificationEmail(locale, link)` consumes it.
- Type consistency: `AccountClient`, `AccountProfile`, `AccountVault`, `linkDeviceKey`, `lang` codes and `LOCALES` are defined once and referenced by later tasks.
- Review Focus tests are placed in Tasks 5, 7, 13 and 16.
- Deliberate gaps left to the builder: exact component markup/CSS, translation wording, and HTTP status for a few error branches are not fixed by the spec.
