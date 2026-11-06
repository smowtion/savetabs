# SaveTabs — privacy notes for store review

Internal reference for the Chrome Web Store privacy practices form and the
Firefox Add-ons data-collection declaration. It mirrors the public privacy
policy at `/privacy` and the Worker schema; keep the three in sync.

## Short version

- Accounts are optional. Without one, the sync key is the only credential; an
  optional account stores an email address, a password-derived proof hash, KDF
  salt and iteration count, the wrapped sync key, hashed tokens, and daily
  email-send counters.
- Verification and password-reset email is delivered through Resend, which
  receives the email address and message content only.
- The server never receives the password, master key, sync key, or readable
  URLs and page titles.
- Session contents are end-to-end encrypted. The server stores only ciphertext
  plus derived identifiers and timestamps.
- No analytics, tracking pixels, advertising, or third-party scripts.
- Private/incognito sessions are local-only and never uploaded.
- The recovery key is the sync key. Losing both the password and the recovery
  key makes synced data unrecoverable; there is no server-side reset.

## What is stored on the device

- Sessions live in the extension's IndexedDB database (`savetabs`). Each session
  contains the saved tab URLs, titles, favicons (when a small URL is available),
  timestamps, and the private-window flag.
- Settings, UI preferences, discard bookkeeping, sync status flags, and the
  locally generated sync key live in `extension.storage.local`.
- When signed in, the opaque account bearer token lives in
  `extension.storage.local` (extension) or `localStorage` (web). Signing out
  removes only that token; the sync key and sync settings stay.
- Nothing leaves the device unless the user enables sync or signs in.

## What the sync server stores

Per sync key (`auth_id`, a public value derived from the sync key):

| Data | Purpose |
| --- | --- |
| `auth_id` | Public account id derived with HKDF-SHA256; appears in API paths and cannot be turned back into the key. |
| `key_hash` | SHA-256 hash of the derived bearer auth key. Compared in constant time to authenticate requests; not reversible. |
| `created_at`, `last_seen_at` | Key registration and last-use timestamps. |
| Encrypted session blobs | `base64url(IV \|\| AES-GCM ciphertext)` with `session_id`, `updated_at`, and ciphertext byte `size`. The server cannot decrypt them. |
| Deletion tombstones | `session_id` + `deleted_at`, so another device does not re-upload a deleted session. Pruned during later deletions once older than 30 days. |
| Rate-limit records | Cloudflare rate-limit buckets keyed by client IP (120 requests/minute) and by `auth_id` (240 requests/minute, charged only after authentication). Short-lived; they contain no URLs or titles. |
| Daily counters | Global per-UTC-day request and key-registration counts (`counters.day`, `requests`, `keys_created`) used for abuse caps. Aggregate only; not linked to a user or key. |

The server never receives the sync key, plaintext URLs, page titles, favicons,
or any browsing content.

## Optional account data

Accounts are optional and only exist after signup. Per account (`accounts.id`):

| Data | Purpose |
| --- | --- |
| `email` | Lowercased, trimmed address used to sign in and to address verification and password-reset messages. |
| `auth_hash` | Hex SHA-256 of the password-derived authentication proof. The proof is HMAC-SHA256 of the PBKDF2-SHA256-stretched password; neither the password nor the proof itself is stored. |
| `kdf_salt`, `kdf_iterations` | PBKDF2-SHA256 parameters. The 16-byte salt is derived from the normalized email; production uses 600,000 iterations. |
| `wrapped_key` | `base64url(IV \|\| ciphertext)`: the sync key wrapped with AES-GCM-256 under a key derived from the password, with AAD `savetabs:vault:v1:<authId>`. The server cannot unwrap it. |
| `auth_id` | The linked sync key's public id. Null until the account is linked to a sync key. |
| Account tokens (`account_tokens`) | SHA-256 hashes of 30-day bearer session tokens; `last_used_at` is refreshed on use. |
| Verification and reset tokens (`email_verifications`) | SHA-256 hashes, 24-hour expiry, a `purpose` of `verify` or `reset`, and `used_at` for single use. |
| Email-send counters (`email_sends`) | Per-account per-UTC-day outbound email count, capped at 5. |

Raw tokens exist only in the user's browser or in the email we send. The
sync-key tables (ciphertext blobs, tombstones, key hashes) are unchanged by
accounts; an account points at one sync key through `auth_id`.

## Encryption details

- The sync key is 128 random bits rendered as `ST-…` Crockford Base32.
- HKDF-SHA256 with the fixed salt `savetabs-v1` derives three independent
  values: `authId`, `authKey`, and `encKey`.
- Every session is encrypted separately with AES-GCM 256 using a random 12-byte
  IV. AAD binds the ciphertext to `savetabs:v1:<authId>:<sessionId>` so blobs
  cannot be swapped between sessions or keys.
- `encKey` never leaves the client. The server stores `SHA-256(authKey)` only.
- Account passwords are stretched with PBKDF2-SHA256 (600,000 iterations,
  per-account salt). The master key stays on the device and derives two
  independent values: an HMAC-SHA256 authentication proof (the server stores
  only its SHA-256) and an HKDF-SHA256 AES-GCM-256 wrapping key.
- The account vault stores the sync key encrypted with that wrapping key. AAD
  binds the vault to `savetabs:vault:v1:<authId>`, so the server cannot move a
  wrapped key to another account. The password, master key, wrapping key and
  sync key never reach the server.

## Key loss

The recovery key is the sync key. Without an account, there is no recovery
path: no email, password, or server-side key escrow, so losing the sync key
makes encrypted sessions on the server unreadable. With an account, the
password unwraps the sync key and a signed-in user can view the same recovery
key; if the user loses both the password and the recovery key, the encrypted
cloud data cannot be recovered, and support cannot reset it. The extension
warns about this before enabling sync, when revealing the key, and when
importing or rotating a key.

## Private / incognito windows

Sessions saved from private or incognito windows are marked local-only in the
extension. They are never uploaded to the sync server and never appear in the
web app. Chrome's "Allow in incognito" setting controls whether the extension
can run there at all.

## Deletion

- Local sessions: delete individual sessions in the Sessions page, or clear the
  extension's data / uninstall it. Settings → Advanced → Clear local sessions
  removes local rows without writing deletion tombstones, so cloud copies stay
  on the server and may be downloaded again on the next sync.
- Cloud data: Settings → Sync → Delete cloud data calls `DELETE
  /v1/keys/{authId}`. It removes every encrypted session, every tombstone, and
  the key record, then turns sync off so local sessions are not uploaded again.
  Rotating the key also calls the same delete endpoint for the old key, so the
  previous key's cloud data is removed; if that call fails, import the old key
  and use Delete cloud data to remove it.
- Uninstalling the extension does not delete cloud data; the user must use
  Delete cloud data (or the web app's delete action) first.
- Account data: deleting the account calls `DELETE /v1/accounts` and removes
  the email, password proof hash, KDF salt and iterations, wrapped key, account
  session tokens, verification/reset tokens, and email-send counters. The sync
  key's encrypted data is intentionally left untouched, so the user must also
  use Delete cloud data to remove synced sessions.

## Analytics and third parties

None in the extension or web app. The extension bundles its own code and
fonts-free styling. It makes requests only to the configured sync API origin,
and only when sync is enabled (plus the release version check served by the
same origin). There are no content scripts, remote scripts, telemetry
endpoints, or advertising SDKs.

Resend is the only external processor: it delivers account verification and
password-reset email and receives the user's email address and the message
content. It never receives the password, master key, sync key, or session
data.

## Store-form answers

- Chrome Web Store, single purpose: "Save and restore browser tab sessions."
- Chrome Web Store, remote code: **No**. Every line of code ships inside the
  package; the update check fetches a JSON manifest (`versions.json`), never
  executable code, and nothing is evaluated at runtime.
- Chrome Web Store, data usage — check these four:
  - **Personally identifiable information**: an email address, only if the user
    creates the optional account. It is used to sign in and to address
    verification and password-reset email, delivered through Resend. It is not
    sold or used for advertising.
  - **Authentication information**: the derived bearer auth key authenticates
    sync requests; the server stores only its SHA-256 hash and never the sync
    key. For accounts, the server stores a SHA-256 hash of the password-derived
    authentication proof, KDF salt and iterations, and the sync key wrapped
    under a password-derived key. It never receives the password or the master
    key.
  - **Web history**: with sync enabled, tab URLs, page titles and visit times
    are uploaded, encrypted with the sync key before they leave the browser.
  - **Location**: short-lived rate-limit buckets are keyed by client IP address.
    They contain no URLs or titles and expire within the rate-limit window.
  - Everything else (health, financial, personal communications, user activity,
    website content) is **No**: not collected.
- Chrome Web Store, certifications: all three (no sale/transfer outside
  approved use, no unrelated purposes, no creditworthiness/lending use).
- Firefox Add-ons, data collection: `data_collection_permissions.required =
  ["none"]`; optional `browsingActivity` (synced URLs and titles, only after
  the user enables sync), `authenticationInfo` (account proof hash and wrapped
  sync key), `personallyIdentifyingInfo` (account email address), and
  `technicalAndInteraction` (request metadata such as the client IP used for
  rate limiting, and the daily version check). Sync and accounts are opt-in, so
  nothing is required; data is not sold or transferred.
- Contact: support@azcom.dev; the public policy lives at
  https://savetabs.azcom.dev/privacy.

## AMO submission answers

- Experimental: **No**. Payment/non-free/hardware: **No**.
- Categories: **Tabs** and **Privacy & Security**.
- Support website: https://savetabs.azcom.dev
- License: **All Rights Reserved** (repository is private; no LICENSE file).
- Privacy policy: **Yes** — https://savetabs.azcom.dev/privacy
- Notes to reviewer (paste into the form):

```text
SaveTabs saves open tabs as named sessions and restores them later. Sync is
optional and end-to-end encrypted.

Build from the attached sources zip:
1. Node.js 22.12+ and pnpm 10.33 (`corepack enable` reads the pinned
   packageManager field).
2. pnpm install --frozen-lockfile
3. pnpm --filter @savetabs/extension exec wxt prepare
4. WXT_SAVETABS_API_BASE=https://savetabs-api.azcom.dev \
     pnpm --filter @savetabs/extension zip:firefox
   Output: apps/extension/.output/savetabs-0.1.0-firefox.zip

The submitted build is minified; the sources zip contains the same tree and
these commands reproduce the package.

Runtime notes:
- Manifest V3 with an event-page background script; no service worker.
- No remote code. The daily update check fetches a JSON manifest from
  https://savetabs-api.azcom.dev/v1/version and compares version numbers; no
  fetched content is evaluated.
- Permissions: tabs (save/restore), storage (settings and local sessions),
  alarms (auto-discard schedule and update check), contextMenus (right-click
  actions). Host permission is limited to https://savetabs-api.azcom.dev/*.
  Accounts add no permissions and reuse the same single API host permission.
- Sync is opt-in. A 128-bit sync key is generated locally; sessions are
  encrypted in the browser with AES-GCM-256 and only ciphertext is uploaded.
  The server stores a public authId, a SHA-256 hash of a derived bearer key,
  encrypted blobs, timestamps and deletion tombstones. The sync key never
  leaves the device.
- Accounts are optional and add no permissions. Signup stores an email
  address, a password-derived proof hash, KDF salt and iterations, the sync
  key wrapped under a password-derived key, hashed session and email tokens,
  and daily email counters. Verification and reset mail goes through Resend.
  The password, master key and sync key never reach the server. The recovery
  key is the sync key; losing both the password and the recovery key makes
  cloud data unrecoverable.
- Incognito/private sessions are marked local-only and never uploaded.
- Auto-discard uses tabs.discard and is disabled where the API is unavailable.
- No analytics, telemetry, content scripts or third-party services except
  Resend for account email.
- To test sync: Settings → Sync → create a key, save a window, then open the
  key in https://savetabs.azcom.dev.

Declared data collection: required none; optional browsingActivity (synced
tab URLs/titles after the user enables sync), authenticationInfo (account
proof hash and wrapped sync key), personallyIdentifyingInfo (account email
address), and technicalAndInteraction (IP used for rate limiting, version
check).
```
