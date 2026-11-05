# SaveTabs accounts, landing page, and localization — design

**Date:** 2026-11-06
**Status:** draft for review
**Related:** `docs/superpowers/specs/2026-11-04-savetabs-design.md`, `plans/261104-2044-savetabs-implementation/plan.md`

## Intent

Today the only credential is a sync key: a user who wants the same sessions on a
second device must copy an `ST-…` key. The product is live (Chrome pending
review, AMO submission in progress) with a minimal web app whose landing page is
just a key input.

We want three additions:

1. **Accounts** so a new device only needs email and password, while keeping the
   end-to-end encryption promise: the operator must never be able to decrypt
   session data.
2. **A real landing page** with the information a visitor needs — what the
   extension does, how it works, privacy, install steps, support — modelled on
   the structure of one-tab.com but without unmeasured claims.
3. **Twelve languages**: English and Vietnamese (existing) plus Simplified
   Chinese, Spanish, Hindi, Arabic, Portuguese, Russian, Japanese, French,
   German, and Korean. Arabic requires RTL layout.

The key-only path stays available in parallel. Accounts are optional.

## Goals and non-goals

Goals:

- Sign up with email + password, verify the email through Resend, and sign in
  from the web app and the extension.
- On a new device, email + password unlocks sync without copying the key.
- A recovery key (the existing `ST-…` sync key) restores access when the
  password is lost; there is no server-side escrow and no password-reset flow
  that can decrypt data.
- Key-only users keep working unchanged; an existing key can be attached to a
  new account.
- The landing page explains the product, privacy model, install and uninstall,
  and offers both "create account" and "use a key".
- All UI strings exist in twelve languages, with Arabic RTL.

Non-goals:

- Payments, subscriptions, invoices (accounts are prepared for a later billing
  link, nothing is built now).
- Social/OAuth login: deriving the wrapping key from a password is central to
  the security model; passwordless providers would need a separate design.
- Replacing key-derived sync authentication with account tokens. Sync keeps
  using the key-derived bearer; account tokens only guard account endpoints.
- Safari, Firefox Android, mobile browsers as first-class targets.
- Server-side password reset without the recovery key.

## Security model

The server must never be able to derive the encryption key. The design follows
the Bitwarden-style split: the password is stretched on the client and only a
derived proof is sent.

1. Client stretches the password:
   `masterKey = PBKDF2-SHA256(password, kdfSalt, 600000, 32 bytes)`.
   `masterKey` never leaves the device.
2. Client derives the authentication proof:
   `authHash = HMAC-SHA256(masterKey, "savetabs-auth-v1")`.
   `authHash` is sent to the server; the server stores only
   `SHA-256(authHash)`. A 256-bit proof needs no slow server-side hash.
3. Client derives the wrapping key:
   `wrapKey = HKDF-SHA256(masterKey, salt="savetabs-v1", info="vault-wrap")`.
   The vault is `AES-GCM-256(wrapKey, IV)` over the 128-bit sync key, with AAD
   `savetabs:vault:v1:<accountId>`; stored as `base64url(IV || ciphertext)`.
4. The sync key is unchanged: HKDF with salt `savetabs-v1` still derives
   `authId`, `authKey`, `encKey`; session encryption and sync requests are
   untouched.

What the server stores: email, `SHA-256(authHash)`, KDF salt and iteration
count, wrapped key ciphertext, linked `authId`, timestamps, account session
token hashes, email-verification token hashes, and the existing sync tables.

What the server never sees: password, `masterKey`, sync key, `encKey`, plaintext
URLs/titles.

Limitations to state in the privacy policy: the server observes the login
exchange (email, `authHash`) over TLS and could attempt offline password
guessing against its stored data; the web app cannot protect against a
compromised server serving modified JavaScript, while the extension bundles its
code.

Recovery: the recovery key is the sync key itself. A user who forgot the
password but holds the key can authenticate to the sync API with the key-derived
bearer, which proves possession; the client then re-wraps the key under a new
password and updates the account. No email-based reset exists for data-bearing
accounts.

Threat-model notes: account tokens grant profile endpoints only. Changing the
password or deleting the account requires the current `authHash`, which only the
password holder can compute. Linking a key to an account requires the key-derived
bearer, so an account cannot claim another user's `authId`.

## Flows

Signup (web or extension):

1. Email + password (minimum 12 characters, confirm field). Client generates a
   random 16-byte KDF salt, derives `masterKey`, `authHash`.
2. `POST /v1/accounts/signup` with email, `authHash`, salt, iterations. The
   account is created unverified; no key material yet.
3. Server sends a verification email through Resend (24-hour, single-use
   token); signup succeeds immediately and the user is signed in.
4. First login on a device: the server returns the vault. When the account has
   no vault yet, the client links the device's existing key (the extension
   always has one) or generates a new key on a fresh device, encrypts it with
   `wrapKey`, and calls `POST /v1/accounts/key` with the account token plus a
   key-derived bearer. The server registers the key if needed and links
   `authId`.
5. Client shows the recovery key once and requires an explicit "I saved it"
   confirmation. For a key that already existed on the device, this is the
   familiar `ST-…` key the user may have seen before.

Signup and login send the client locale; the account stores it for
verification email language.

The email is verified in the background: a banner appears on the web and in
the extension until verification, with a resend action. Login is not blocked.

New device: email + password → login returns salt, iterations, wrapped key →
client derives `masterKey`, unwraps the sync key → all existing sync paths run
unchanged.

Key-only attach: a user enters their existing key, then adds email/password;
the client wraps the existing key and links it, keeping the data.

Password change: requires the current password (`oldAuthHash`); client derives a
new `masterKey` with a fresh salt, re-wraps the key, sends
`{oldAuthHash, newAuthHash, kdfSalt, wrappedKey}`; the server revokes all other
account tokens.

Recovery: user supplies email, recovery key, new password. Client derives the
key bearer and the new `authHash`; `POST /v1/accounts/recover` verifies that the
bearer's `authId` matches the account's linked id and the email matches, then
stores the new proof and wrapped key and revokes tokens. No email is sent.

Delete account: requires the password (`authHash` proof). Removes the account
row, tokens, verification rows and vault record. Sync data is not deleted
automatically; the confirmation offers "also delete cloud data", which runs the
existing key deletion.

## Key reconciliation and key changes

- **Signup never silently creates a second vault.** If the account has no vault
  and the device already holds a key, that key is wrapped and linked; the
  recovery key shown is that same key.
- **Signing in adopts the account vault.** If the device key differs, the
  account key replaces it. When local sessions were saved under the old key,
  the client asks "Upload these sessions to this account?"; accepting
  re-encrypts them under the account key on the next sync, declining marks
  them local-only (`syncExcluded`). Local sessions that exist only on this
  device are never deleted by the switch.
- **Sign-out keeps the local key and sync state.** Only the account token is
  removed.
- **Rotate and import must re-link first.** While signed in, a key change
  re-wraps the new key and calls `POST /v1/accounts/key` with the account
  token, the new key bearer and the current `authHash` proof before it deletes
  old cloud data or completes the import. A missing proof aborts the whole
  operation; a failed re-link leaves the account and key untouched.
- **Login does not silently enable sync.** On the extension the vault is
  unwrapped, then one confirmation ("Enable sync on this device?") flips
  `sync.enabled` and starts the initial sync. Account users no longer need the
  "I saved the key" gate because the vault makes the key recoverable with the
  password; key-only users keep it.
- **Accounts without a vault** have nothing to decrypt, so they can reset by
  email: a single-use link sets a new `authHash` and salt. The endpoint refuses
  once `auth_id` is set, so email reset can never reach encrypted data.
  Unverified, unlinked accounts are deleted by a scheduled cleanup after 30
  days. Signup for an existing email returns the same generic response as a
  new signup and sends a notice instead of disclosing account existence.

## Data model

New D1 migration `0002_accounts.sql`:

```sql
CREATE TABLE accounts (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE,      -- lowercased, trimmed
  auth_hash        TEXT NOT NULL,             -- hex SHA-256 of the client proof
  kdf_salt         TEXT NOT NULL,             -- base64url, 16 bytes
  kdf_iterations   INTEGER NOT NULL,
  wrapped_key      TEXT,                      -- base64url(IV || ciphertext)
  auth_id          TEXT UNIQUE,               -- linked sync key, null until set
  locale           TEXT NOT NULL DEFAULT 'en', -- verification/reset email language
  email_verified_at INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE account_tokens (
  token_hash    TEXT PRIMARY KEY,             -- hex SHA-256 of the bearer token
  account_id    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_used_at  INTEGER NOT NULL
);

CREATE TABLE email_verifications (
  token_hash  TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  purpose     TEXT NOT NULL                   -- 'verify' | 'reset'
);
```

Tokens are 32 random bytes, bearer, 30-day expiry, revoked on password change,
recovery and account deletion. All account lookups are by unique email or token
hash; no listing endpoints.

## API

All routes under `/v1/accounts`, JSON, same error envelope and rate limiting as
sync. Account endpoints get per-IP and per-email buckets; Resend calls are
capped per account per day.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/signup` | none | Create account, send verification email |
| POST | `/login` | none | Verify `authHash`, return token + vault |
| POST | `/logout` | token | Revoke current token |
| GET | `/me` | token | Profile, verification state, linked `authId` |
| POST | `/verify-email` | none | Consume verification token |
| POST | `/resend-verification` | token | New verification email, rate limited |
| POST | `/key` | token + key bearer (+ `authHash` to replace) | Register/link the sync key, store wrapped key |
| POST | `/password` | token | Change password, revoke other tokens |
| POST | `/recover` | key bearer | Reset password with the recovery key |
| POST | `/reset-unlinked` | none | Email a reset link for an account with no vault |
| POST | `/reset-unlinked/confirm` | none | Set new `authHash` and salt from the reset token |
| DELETE | `/` | token + `authHash` | Delete account |

Responses never include `auth_hash`, salts beyond the account's own, or token
values after creation.

## Web app

Routes: `/` (landing), `/signup`, `/login`, `/verify`, `/account`, `/sessions`,
`/privacy`.

- Landing: sections described under "Landing page"; account buttons, key entry
  kept as a secondary path.
- `/signup`: email, password, confirm; client-side derivation with a loading
  state (PBKDF2 600k takes a moment); on success redirect to `/sessions`.
- `/login`: email, password; unwraps the vault and stores the sync key following
  the existing remember-me rules; "Forgot password? Use recovery key" opens the
  recovery form.
- `/verify`: consumes the token from the email link and shows the result.
- `/account`: email, verification banner + resend, change password, view
  recovery key (requires re-entering the password), logout, delete account.
- `/sessions`: unchanged except that a signed-in account can reach it without
  typing a key; key entry still works. An account token without an unlocked
  key (new tab, restart without remember) shows an inline "Unlock with
  password" form instead of redirecting.
- Session tokens live in `localStorage`; the sync key follows the existing
  session/localStorage remember rules, and `/login` keeps the remember-me
  control.

## Extension

The Sync section in Options gains an account card:

- Signed out: email/password sign-in, "Create account" (inline form, same
  client), "Use a key instead".
- Signed in: email, verification badge, sign out, change password, view
  recovery key.
- Signing out removes the account token but keeps the local sync key, so sync
  continues until the user removes the key.
- First key creation shows the recovery key dialog with a required
  acknowledgement.
- Background sync, alarms and update checks are unchanged.

Account state is stored in `storage.local`; no new permissions are required.
The web and extension share an `AccountClient` in `packages/shared`.

## Landing page

Sections, in order:

1. Header: logo, language menu, theme control, "Open web app" / account button.
2. Hero: headline, short description, install buttons for Chrome and Firefox
   (Firefox disabled until AMO publishes), "No account needed — sync is
   optional" reassurance, popup/sessions mockup.
3. How it works: save a window, tabs close, restore later (3 steps with
   screenshots).
4. Privacy: E2EE, key-only path, local-first, private windows never uploaded;
   link to `/privacy`.
5. Features: search, rename, export/import, auto-discard, multi-device sync,
   private/incognito local-only.
6. Account: create account / sign in, plus "or use a sync key".
7. Install, uninstall and troubleshooting: short, factual.
8. Support and footer: support email (pending), privacy policy, store links.

Do not claim memory percentages or benchmark numbers; the copy stays factual.

## Localization

Twelve locales: `en`, `vi`, `zh-CN`, `es`, `hi`, `ar`, `pt`, `ru`, `ja`, `fr`,
`de`, `ko`.

- One JSON file per locale in `packages/shared/src/i18n/`, same key set as `en`;
  the existing parity test runs over every locale.
- A locale registry holds the code, native name, and direction. `resolveLang`
  maps `navigator.language` prefixes (`zh`, `pt`, `es-*`, …) and falls back to
  English.
- Extension: the language setting becomes a select built from the registry
  (`auto` + twelve entries).
- Web: the header toggle becomes a menu listing all locales.
- Arabic sets `dir="rtl"` on `<html>`. Audit components for physical utilities
  (`pl/ pr/ ml/ mr/ left/ right`, directional icons) and migrate to logical
  properties (`ps/ pe/ ms/ me`, `start/ end`) where they are not already.
- Translations are AI-drafted and flagged for native review; English remains the
  source of truth. Placeholders and brand names are preserved verbatim.
- Verification and reset emails are localized from the account `locale` with an
  English fallback; templates live in the worker and reuse the UI wording.
- The privacy policy stays English, with a note that the English version
  prevails; the language menu does not claim a translated policy.

## Privacy and store updates

Account data changes the declarations on both stores:

- Chrome data usage: add **Personally identifiable information** (email) and
  keep **Authentication information** (password-derived proof and session
  tokens) alongside the existing Web history / Location set. Update listing
  copy: "No account needed" rather than "No accounts".
- AMO: `data_collection_permissions` gains `personallyIdentifyingInfo` and
  `authenticationInfo` (required none remains; sync and accounts are opt-in).
- Privacy policy: add email, the derived proof, wrapped key, tokens, Resend as a
  processor (email delivery), and the recovery-key limitation.
- Store copy in `apps/extension/store/description.md` and the privacy notes must
  be updated before the account release is submitted.

## Compatibility and operations

- Existing key-only users are unaffected; no migration of session data.
- Accounts use new tables; sync schema is untouched.
- Resend requires `RESEND_API_KEY` (secret) and a verified sending domain
  (`azcom.dev` or a `mail.` subdomain); the from address is configurable.
- Daily caps and rate limits apply to account endpoints; a new account does not
  bypass sync quotas.
- Account rows are small; no new R2 usage.

## Testing

- Shared: KDF derivation vectors (fixed password/salt → known `masterKey`,
  `authHash`, `wrapKey`), vault round-trip, wrong-password failure, recovery
  re-wrap.
- Worker: signup/login/recover/password/delete flows with in-memory D1;
  token revocation; email verification lifecycle; rate limits; email enumeration
  resistance (login always takes the same path).
- Web: auth pages, guarded routes, recovery flow, verification banner.
- Extension: account card states, key linking, sign-out keeps key, recovery key
  dialog acknowledgement.
- i18n: parity for twelve locales, `dir` for Arabic, no horizontal overflow at
  360 px in popup and 1280 px in options.
- E2E: signup → verify → save tabs → new device login → sessions visible.

## Phasing

1. Shared crypto/account client + worker migration and endpoints + tests.
2. Web signup/login/recovery/account pages and session entry.
3. Extension account UI + key linking + tests.
4. Landing page redesign (en/vi).
5. Ten locales + RTL audit + language menu.
6. Privacy/store updates; submit Chrome update and AMO version.

Billing, OAuth, and account-token-based sync remain out of scope.

## Open items

- Support email address for the landing footer and store listings (owner).
- Resend sending domain and API key (owner, dashboard action).
- Native review for the ten translations before calling them final.
