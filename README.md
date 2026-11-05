# SaveTabs

SaveTabs turns the tabs in a window into a saved session you can restore later.
Save a window in one click, close the tabs to free memory, then reopen the exact
set in the same order. Sessions stay on the device unless the user enables
optional end-to-end encrypted (E2EE) sync.

> **Status:** SaveTabs is **not published yet**. The API and web origins, the
> D1 database binding, and the store listing URLs are placeholders until the
> live deployment and store submission are completed. See
> [Status and placeholders](#status-and-placeholders).

## Architecture

| Path | Role |
| --- | --- |
| `apps/extension` | WXT + React Manifest V3 extension: popup, options, sessions page, background service worker, local IndexedDB storage, E2EE sync client. |
| `apps/worker` | Hono API on Cloudflare Workers: sync endpoints, D1 for key hashes/tombstones/counters, R2 for release artifacts, optional rate-limit bindings. |
| `apps/web` | Vite + React web app: landing page, sessions viewer, privacy policy. Decrypts locally with the sync key. |
| `packages/shared` | Shared TypeScript types, settings schema, key derivation and AES-GCM helpers, i18n strings, and the HTTP sync client. |

Sync flow: the extension derives keys locally and encrypts each session with
AES-GCM 256 before upload. The Worker stores ciphertext, a public `authId`
derived from the sync key, a SHA-256 hash of the derived auth key, timestamps,
and deletion tombstones. The server never receives the sync key or plaintext
URLs and titles.

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
| `VITE_API_BASE` | Web build (Vite) | `https://api.savetabs.example` | Sync API origin used by the web app. Must share its origin with `WXT_SAVETABS_API_BASE`; the release guard also requires that origin in `apps/web/public/_headers` (`connect-src`). |
| `SAVETABS_NOTES_URL` | `scripts/update-versions.mjs`, CI | Script fallback: `https://savetabs.pages.dev/releases/<version>`; CI and Release read the repository variable, currently `https://savetabs.azcom.dev` | Release-notes URL written into `versions.json`. |
| `WEB_ORIGIN` | Worker runtime | `https://savetabs.azcom.dev` | CORS allowlist. Defined in `apps/worker/wrangler.toml` `[vars]`. |
| `GLOBAL_DAILY_REQUESTS` | Worker runtime | `100000` | Daily request cap. Defined in `wrangler.toml`. |
| `GLOBAL_MAX_KEYS` | Worker runtime | `10000` | Daily cap on newly registered sync keys. Defined in `wrangler.toml`. |

Cloudflare and store credentials are **secrets** and belong in GitHub
repository secrets, never in the repository:

- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`,
  `CHROME_REFRESH_TOKEN` (all four are required together)
- `FIREFOX_EXTENSION_ID` (must equal the gecko id in
  `apps/extension/wxt.config.ts`), `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET`
  (all three are required together)

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
   complete Chrome tuple (`CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`,
   `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`) and/or the complete Firefox
   tuple (`FIREFOX_EXTENSION_ID`, `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET`).
   A partially configured store fails the release; a fully absent one is
   skipped.
5. Tag the commit as `v<version>` and push the tag, or run the workflow
   manually. The tag must match the package version.

The workflow builds and verifies the artifacts, then:

- Verifies the built web CSP allows the configured API origin and that the
  extension and web builds agree on it (`scripts/verify-csp.mjs`).

- Uploads `chrome/savetabs-<version>.zip` and `firefox/savetabs-<version>.zip`
  to the `savetabs-releases` R2 bucket.
- Uploads `versions.json` to the bucket root. `GET /v1/version` serves it with
  a five-minute cache.
- Deploys the Worker (`wrangler deploy`) and the web app to the `savetabs`
  Cloudflare Pages project.
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

- No account, email address, or password. The generated sync key is the only
  credential.
- Session contents are encrypted in the browser with AES-GCM 256 before upload.
  The server stores ciphertext, a public `authId`, a hash of the derived auth
  key, timestamps, deletion tombstones, and short-lived rate-limit counters.
  It never receives the sync key or readable URLs, titles, or favicons.
- Private/incognito sessions are local-only and are never uploaded.
- There are no analytics, ads, tracking pixels, content scripts, or remotely
  loaded third-party scripts.
- Losing the sync key makes synced data unrecoverable; there is no server-side
  reset. JSON session export/import is the local recovery path.
- Users can delete all cloud data from Settings → Sync → Delete cloud data.

Details: `apps/extension/store/privacy-notes.md` and the web app's `/privacy`
page.

## Deployment status

v0.1.0 is live on Cloudflare:

- API: `https://savetabs-api.azcom.dev` — Worker `savetabs`, D1 database
  `savetabs`, R2 bucket `savetabs-releases` (`versions.json` for the update
  check).
- Web: `https://savetabs.azcom.dev` — static-assets Worker `savetabs-web` with
  SPA fallback, so `/privacy` and `/sessions` resolve on first load.
- Extension packages: `apps/extension/.output/savetabs-0.1.0-{chrome,firefox}.zip`,
  built with `WXT_SAVETABS_API_BASE=https://savetabs-api.azcom.dev`.

Chrome Web Store listing is submitted and pending review
(`https://chromewebstore.google.com/detail/ajejilnkhplcpgcjfkidkdepjipmocfi`);
the Firefox Add-ons listing is not created yet. Store listing copy lives in
`apps/extension/store/description.md`, permission justifications in
`apps/extension/store/permissions.md`, and the privacy answers in
`apps/extension/store/privacy-notes.md`. Screenshots for the Chrome listing are
generated from the built extension:

```bash
WXT_SAVETABS_API_BASE=https://savetabs-api.azcom.dev pnpm --filter @savetabs/extension build
pnpm --filter @savetabs/extension screenshots
```

## Remaining placeholders

- Support contact in the store listing; the `/privacy` page points readers to
  that listing.
- Firefox Add-ons listing URL in `apps/extension/lib/store-urls.ts` and the
  Firefox link in `apps/extension/store/description.md` once AMO submission
  exists. The add-on id is `savetabs@azcom.dev`; the AMO data-collection
  declaration is `required: ["none"]`, optional `browsingActivity` and
  `technicalAndInteraction`.
- Build-time defaults (`https://api.savetabs.example` in
  `apps/extension/lib/config.ts` and `apps/web/src/lib/config.ts`) stay as
  guards for builds that forget to set the API origin.
