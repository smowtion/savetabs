# SaveTabs

SaveTabs turns the tabs in a window into a saved session you can restore later.
Save a window in one click, close the tabs to free memory, then reopen the exact
set in the same order. Sessions stay on the device unless the user enables
optional end-to-end encrypted (E2EE) sync.

[Website](https://savetabs.azcom.dev) ·
[Changelog](https://savetabs.azcom.dev/changelog) ·
[GitHub](https://github.com/smowtion/savetabs) ·
[MIT License](LICENSE)

![SaveTabs overview](apps/web/public/screenshots/overview-showcase.webp)

> **Status:** Open source under the MIT License. Chrome and Firefox listings
> are live; the Chrome 0.2.2 update is in review. Safari has an MV3 build but
> is not distributed yet. The API and web are deployed on Cloudflare.
> Credential setup: `docs/store-publishing-setup.md`. Safari conversion:
> `docs/safari-extension-guide.md`.

## Features

- Save the current window or every window as a named session from the toolbar,
  keyboard shortcut, or context menu; restore tab order and pinned state.
- Optional end-to-end encrypted (E2EE) sync: URLs, titles, and favicons are
  encrypted in the browser with AES-GCM 256, and the server stores only
  ciphertext.
- Optional accounts: sign up with an email and password to make sync easier
  across devices. The password unlocks the wrapped sync key locally; the server
  stores the email, a password-derived proof hash, KDF salt and iterations, the
  wrapped sync key, hashed session and email tokens, and daily email counters.
  A recovery key (the sync key) is shown when an account is linked and can be
  viewed later from the account page.
- Sessions saved from private or incognito windows stay local-only.
- Interface in English, Vietnamese, and ten more locales; light, dark, and
  system themes.
- No analytics, third-party trackers, content scripts, or remote code.

## Architecture

| Path | Role |
| --- | --- |
| `apps/extension` | WXT + React Manifest V3 extension: popup, options, sessions page, background service worker, local IndexedDB storage, E2EE sync client, optional account session. |
| `apps/worker` | Hono API on Cloudflare Workers: sync and account endpoints, D1 for key hashes/tombstones/counters plus account, email-token, and email-send records, R2 for release artifacts, optional rate-limit bindings. |
| `apps/web` | Vite + React web app: landing page, account signup/login/verify/recovery, sessions viewer, privacy policy. Decrypts locally with the sync key. |
| `packages/shared` | Shared TypeScript types, settings schema, key derivation and AES-GCM helpers, i18n strings, and the HTTP sync and account clients. |

Sync flow: the extension derives keys locally and encrypts each session with
AES-GCM 256 before upload. The Worker stores ciphertext, a public `authId`
derived from the sync key, a SHA-256 hash of the derived auth key, timestamps,
and deletion tombstones. Accounts are optional; when created, the password is
stretched with PBKDF2-SHA256 and the sync key is wrapped client-side, so the
server never receives the password, master key, sync key, or plaintext URLs and
titles.

More detail: `docs/superpowers/specs/2026-11-04-savetabs-design.md`.

## Prerequisites

- Node.js **22.12+** (the root `engines` field and CI use Node 22).
- pnpm **10.33.0** (pinned by `packageManager`; `corepack enable` or
  `pnpm/action-setup` installs the right version).
- A modern Chromium-based browser or Firefox for manual extension testing.

## Install

```bash
pnpm install
```

The extension's `postinstall` runs `wxt prepare`, which generates `.wxt/`
types used by typechecking. CI also runs it explicitly.

## Commands

Run from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm --filter @savetabs/extension dev` | Start WXT dev mode for the extension. Load the unpacked directory WXT prints in the terminal. |
| `pnpm --filter @savetabs/web dev` | Start the web app's Vite dev server. |
| `pnpm dev:worker` | Start the Worker locally with `wrangler dev`. |
| `pnpm db:migrate:local` | Apply D1 migrations to the local Miniflare database. |
| `pnpm typecheck` | Typecheck every workspace package (`tsc --noEmit`). |
| `pnpm test` | Run all unit and Worker test suites (Vitest). |
| `pnpm test:scripts` | Run the release-script tests (`node --test scripts/verify-csp.test.mjs`). |
| `pnpm build` | Build every package that has a build script (extension + web). |
| `pnpm build:ext` | Build the extension only. |
| `pnpm icons` | Regenerate the 16/32/48/128 px PNG icons from `apps/extension/assets/icon.svg`. Commit the regenerated files. |
| `pnpm zip:chrome` / `pnpm zip:firefox` | Build and package the store ZIPs. |
| `pnpm --filter @savetabs/extension build:safari` | Build the Safari MV3 folder for the Xcode converter (see `docs/safari-extension-guide.md`). |
| `pnpm --filter @savetabs/extension safari:convert` | Convert the Safari build into an Xcode project (macOS + Xcode required). |
| `pnpm zip:sources` | Write the AMO source archive (`savetabs-<version>-sources.zip`) from the tracked monorepo tree; run it after the WXT zip steps because WXT's own sources ZIP only contains `apps/extension`. |
| `pnpm verify:build` | Verify both built manifests, icons, and ZIPs. Run after the `zip:*` commands. |
| `node scripts/update-versions.mjs` | Regenerate `versions.json` from the package versions. |
| `node scripts/update-versions.mjs --check` | Verify that the packages agree and `versions.json` is current. Performs no network access and writes no files. |
| `node scripts/verify-csp.mjs` | Release guard: assert the built `apps/web/dist/_headers` CSP allows `VITE_API_BASE` and that both build origins agree. Run after `pnpm build`. |

Build outputs:

- Extension output: `apps/extension/.output/` (for example `chrome-mv3/`, and
  `firefox-mv3/` after `pnpm zip:firefox`).
- Store ZIPs: `apps/extension/.output/savetabs-<version>-chrome.zip`,
  `savetabs-<version>-firefox.zip`, plus the Firefox sources ZIP.
- Web build: `apps/web/dist/`.

## Environment variables

Build-time values are read from the process environment. The release workflow
injects them from repository variables; for local builds, export them in your
shell. Vite and WXT can also load `.env` files from their own app directories
(`apps/web`, `apps/extension`) when you run them there.

| Variable | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `WXT_SAVETABS_API_BASE` | Extension build (WXT) | `https://api.savetabs.example` | Sync API origin. Also becomes the manifest `host_permissions` entry. |
| `SAVETABS_API_BASE` | Extension build (WXT) | — | Legacy alias for `WXT_SAVETABS_API_BASE`; empty values count as unset. |
| `WXT_SAVETABS_VERSION_URL` | Extension build (WXT) | `https://savetabs.azcom.dev/versions.json` | Static release manifest for the daily update check. Its origin is added to `host_permissions`; the Worker `/v1/version` route remains a fallback. |
| `VITE_API_BASE` | Web build (Vite) | `https://api.savetabs.example` | Sync API origin used by the web app. Must share its origin with `WXT_SAVETABS_API_BASE`; the release guard also requires that origin in `apps/web/public/_headers` (`connect-src`). |
| `SAVETABS_NOTES_URL` | `scripts/update-versions.mjs`, CI | Script fallback: `https://savetabs.pages.dev/releases/<version>`; CI and Release read the repository variable, currently `https://savetabs.azcom.dev` | Release-notes URL written into `versions.json`. |
| `WEB_ORIGIN` | Worker runtime | `https://savetabs.azcom.dev` | CORS allowlist. Defined in `apps/worker/wrangler.toml` `[vars]`. |
| `GLOBAL_MAX_KEYS` | Worker runtime | `50000` | Daily cap on newly registered sync keys. Defined in `wrangler.toml`. |

Cloudflare and store credentials are **secrets** and belong in GitHub
repository secrets, never in the repository:

- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`,
  `CHROME_SERVICE_ACCOUNT_EMAIL`, `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`
  (all four are required together; Chrome Web Store API v2 service account)
- `FIREFOX_EXTENSION_ID` (must equal the gecko id in
  `apps/extension/wxt.config.ts`), `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET`
  (all three are required together)

Step-by-step credential creation: `docs/store-publishing-setup.md`.

`.env.example` lists every name with placeholder values. `.env*` files are
gitignored except `.env.example`; never commit real credentials.

## CI

`.github/workflows/ci.yml` runs on every branch push and pull request; version
tag pushes are handled by Release:

1. pnpm and Node 22 setup with pnpm store caching.
2. Frozen-lockfile install and `wxt prepare`.
3. `versions.json` sync check (with the same optional `SAVETABS_NOTES_URL`
   repository variable Release uses) and the release-script tests.
4. Typecheck, all tests (including the Worker suite), and builds.
5. Extension ZIP packaging, `verify:build`, and artifact upload.

CI needs no Cloudflare or store credentials.

## Release

`.github/workflows/release.yml` runs only on manual `workflow_dispatch` or a
`v*` tag push; ordinary pushes never deploy or publish.

Expected flow:

1. Bump `apps/extension/package.json` and `apps/worker/package.json` to the same
   semver.
2. Regenerate and commit `versions.json`, then verify it is current:
   ```bash
   node scripts/update-versions.mjs
   node scripts/update-versions.mjs --check
   ```
3. Configure the repository variables `WXT_SAVETABS_API_BASE` and
   `VITE_API_BASE` with the deployed HTTPS origins (the workflow refuses to
   publish while either is empty or contains `.example`). Both must share one
   origin, and `apps/web/public/_headers` must list that origin in
   `connect-src`; `node scripts/verify-csp.mjs` fails the release otherwise.
   Optionally set `SAVETABS_NOTES_URL`.
4. Configure the Cloudflare secrets and, if store submission is wanted, the
   complete Chrome tuple (`CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`,
   `CHROME_SERVICE_ACCOUNT_EMAIL`, `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`) and/or
   the complete Firefox tuple (`FIREFOX_EXTENSION_ID`, `FIREFOX_JWT_ISSUER`,
   `FIREFOX_JWT_SECRET`).
   A partially configured store fails the release; a fully absent one is
   skipped.
5. Tag the commit as `v<version>` and push the tag, or run the workflow
   manually. The tag must match the package version.

The workflow builds and verifies the artifacts, then:

- Stages `versions.json` into `apps/web/public/` before the web build, so
  the web Worker serves it as the static update manifest the extension
  prefers. The Worker `/v1/version` route remains a fallback.

- Verifies the built web CSP allows the configured API origin and that the
  extension and web builds agree on it (`scripts/verify-csp.mjs`).

- Uploads `chrome/savetabs-<version>.zip` and `firefox/savetabs-<version>.zip`
  to the `savetabs-releases` R2 bucket.
- Uploads `versions.json` to the bucket root. `GET /v1/version` serves it with
  a five-minute cache.
- Deploys the sync Worker (`wrangler deploy`) and the static-assets web
  Worker (`savetabs-web`).
- Uploads the ZIPs and `versions.json` as workflow artifacts.
- Submits to the Chrome Web Store and Firefox Add-ons only when the matching
  `CHROME_*` / `FIREFOX_*` secrets exist; otherwise those steps skip.

Schema changes are not applied automatically. Run
`pnpm --filter @savetabs/worker db:migrate:remote` explicitly when a release
includes a D1 migration.

R2 layout:

```text
savetabs-releases/
├── versions.json
├── chrome/savetabs-<version>.zip
└── firefox/savetabs-<version>.zip
```

`versions.json` shape (epoch milliseconds for `updatedAt`):

```json
{
  "extension": { "chrome": "0.1.0", "firefox": "0.1.0" },
  "notesUrl": "https://savetabs.pages.dev/releases/0.1.0",
  "updatedAt": 1762300000000
}
```

## Privacy

- No account is required. Local use and key-only sync work with just the
  generated sync key. If the user creates the optional account, the server
  stores the email address, a password-derived proof hash, KDF salt and
  iteration count, the wrapped sync key, hashed account session and
  verification/reset tokens, and daily email-send counters. The password,
  master key, sync key, and readable URLs or titles never reach the server.
- Session contents are encrypted in the browser with AES-GCM 256 before upload.
  The server stores ciphertext, a public `authId`, a hash of the derived auth
  key, timestamps, deletion tombstones, and short-lived rate-limit counters.
- Resend processes account verification and password-reset email; it receives
  the email address and message content only.
- Private/incognito sessions are local-only and are never uploaded.
- There are no analytics, ads, tracking pixels, content scripts, or remotely
  loaded third-party scripts.
- Losing both the account password and the recovery key (the sync key) makes
  synced data unrecoverable; there is no server-side reset. JSON session
  export/import is the local recovery path.
- Users can delete all cloud data from Settings → Sync → Delete cloud data.
- Store declarations: Chrome Web Store data usage lists personally
  identifiable information (account email), authentication information (sync
  and account credentials), web history, and location (rate-limit IP). AMO
  declares required `none` with optional `browsingActivity`,
  `authenticationInfo`, `personallyIdentifyingInfo`, and
  `technicalAndInteraction`.

Details: `apps/extension/store/privacy-notes.md` and the web app's `/privacy`
page.

## Deployment status

The production deployment runs the 0.2.x line:

- API: `https://savetabs-api.azcom.dev` — Worker `savetabs`, D1 database
  `savetabs`, R2 bucket `savetabs-releases` (`versions.json` for the update
  check).
- Web: `https://savetabs.azcom.dev` — static-assets Worker `savetabs-web` with
  SPA fallback, so `/privacy`, `/changelog` and `/sessions` resolve on first
  load.
- Extension packages: `apps/extension/.output/savetabs-0.2.4-{chrome,firefox}.zip`,
  built with `WXT_SAVETABS_API_BASE=https://savetabs-api.azcom.dev`.

Chrome Web Store 0.2.2 is pending review
(`https://chromewebstore.google.com/detail/ajejilnkhplcpgcjfkidkdepjipmocfi`);
Firefox Add-ons 0.2.2 is live
(`https://addons.mozilla.org/firefox/addon/save_tabs/`). Safari is built but
not distributed yet. Store listing copy lives in
`apps/extension/store/description.md`, permission justifications in
`apps/extension/store/permissions.md`, and the privacy answers in
`apps/extension/store/privacy-notes.md`. Screenshots for the Chrome listing are
generated from the built extension:

```bash
WXT_SAVETABS_API_BASE=https://savetabs-api.azcom.dev pnpm --filter @savetabs/extension build
pnpm --filter @savetabs/extension screenshots
```

## Contributing

See `docs/contributing.md`. Keep changes scoped, add tests for behavior
changes, preserve the E2EE and local-only guarantees, and never commit
credentials or production user data.

## Security

Report vulnerabilities privately to **support@azcom.dev**; do not open a public
issue. See `docs/security.md` for scope and handling.

## License

MIT — see [LICENSE](LICENSE).

## Remaining placeholders

- Safari distribution: the MV3 build exists in
  `apps/extension/.output/safari-mv3/`, but the Xcode project and Mac App Store
  listing still need an Apple Developer account. See
  `docs/safari-extension-guide.md`.
- Build-time defaults (`https://api.savetabs.example` in
  `apps/extension/lib/config.ts` and `apps/web/src/lib/config.ts`) stay as
  guards for builds that forget to set the API origin.
