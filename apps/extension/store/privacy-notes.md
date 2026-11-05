# SaveTabs — privacy notes for store review

Internal reference for the Chrome Web Store privacy practices form and the
Firefox Add-ons data-collection declaration. It mirrors the public privacy
policy at `/privacy` and the Worker schema; keep the three in sync.

## Short version

- No account, email address, or password. The sync key is the only credential.
- Session contents are end-to-end encrypted. The server stores only ciphertext
  plus derived identifiers and timestamps.
- No analytics, tracking pixels, advertising, or third-party scripts.
- Private/incognito sessions are local-only and never uploaded.
- Losing the sync key makes synced data unrecoverable; there is no reset.

## What is stored on the device

- Sessions live in the extension's IndexedDB database (`savetabs`). Each session
  contains the saved tab URLs, titles, favicons (when a small URL is available),
  timestamps, and the private-window flag.
- Settings, UI preferences, discard bookkeeping, sync status flags, and the
  locally generated sync key live in `extension.storage.local`.
- Nothing leaves the device unless the user enables sync.

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
or any browsing content. There is no account system, so there is no email
address, name, or password on the server.

## Encryption details

- The sync key is 128 random bits rendered as `ST-…` Crockford Base32.
- HKDF-SHA256 with the fixed salt `savetabs-v1` derives three independent
  values: `authId`, `authKey`, and `encKey`.
- Every session is encrypted separately with AES-GCM 256 using a random 12-byte
  IV. AAD binds the ciphertext to `savetabs:v1:<authId>:<sessionId>` so blobs
  cannot be swapped between sessions or keys.
- `encKey` never leaves the client. The server stores `SHA-256(authKey)` only.

## Key loss

There is no recovery path: no email, password, or server-side key escrow. If the
user loses the sync key, encrypted sessions on the server are unreadable. The
extension warns about this before enabling sync, when revealing the key, and
when importing or rotating a key.

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

## Analytics and third parties

None. The extension bundles its own code and fonts-free styling. It makes
requests only to the configured sync API origin, and only when sync is enabled
(plus the release version check served by the same origin). There are no
content scripts, remote scripts, telemetry endpoints, or advertising SDKs.

## Store-form answers

- Chrome Web Store, single purpose: "Save and restore browser tab sessions."
- Chrome Web Store, remote code: **No**. Every line of code ships inside the
  package; the update check fetches a JSON manifest (`versions.json`), never
  executable code, and nothing is evaluated at runtime.
- Chrome Web Store, data usage — check these three:
  - **Web history**: with sync enabled, tab URLs, page titles and visit times
    are uploaded, encrypted with the sync key before they leave the browser.
  - **Authentication information**: the derived bearer auth key authenticates
    sync requests; the server stores only its SHA-256 hash and never the sync
    key. There is no account, email address or password.
  - **Location**: short-lived rate-limit buckets are keyed by client IP address.
    They contain no URLs or titles and expire within the rate-limit window.
  - Everything else (PII, health, financial, personal communications, user
    activity, website content) is **No**: not collected.
- Chrome Web Store, certifications: all three (no sale/transfer outside
  approved use, no unrelated purposes, no creditworthiness/lending use).
- Firefox Add-ons: no data collection beyond the encrypted sync service the
  user explicitly enables; request data is not sold or transferred.
- Contact: the support contact on the Chrome Web Store listing; the public
  policy lives at https://savetabs.azcom.dev/privacy.
