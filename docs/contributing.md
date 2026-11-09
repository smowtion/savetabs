# Contributing to SaveTabs

Thanks for helping improve SaveTabs. This repository is the source for the
Chrome, Firefox and Safari extension, the Cloudflare sync Worker and the web
app.

## Before you start

1. Read `README.md` and the architecture notes in `docs/superpowers/specs/`.
2. Check open issues and pull requests so work is not duplicated.
3. Keep changes scoped: one feature or fix per pull request.

## Local setup

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

For the extension during development:

```bash
WXT_SAVETABS_API_BASE=https://savetabs-api.azcom.dev \
  pnpm --filter @savetabs/extension dev
```

The WXT output directory is printed in the terminal; load it from
`chrome://extensions` (Developer mode → Load unpacked). Firefox and Safari
instructions are in `docs/safari-extension-guide.md` and the README.

## Code expectations

- TypeScript strict mode and the existing workspace conventions.
- Add or update tests for behavior changes; do not weaken tests to make a
  change pass.
- Preserve the public sync protocol and the privacy guarantees: session data
  is encrypted in the browser, private windows stay local, and the server
  never receives the sync key.
- Do not commit credentials, private keys, service-account JSON, API tokens,
  personal paths, or production user data.
- Update `README.md` or `docs/` when behavior, setup, commands or architecture
  change.

## Commit and pull request style

Use Conventional Commits without AI attribution, for example:

```text
feat(web): add a changelog page
fix(worker): reject malformed sync payloads
```

Describe the user-visible outcome and the verification you ran. Link the
issue when one exists.

## Security

Do not report vulnerabilities in a public issue. Follow `docs/security.md`.
