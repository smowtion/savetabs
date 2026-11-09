# Store and deploy publishing setup

How to create the credentials the Release workflow needs, then add them as
GitHub Actions secrets. Never commit the real values; `.env*` files are
gitignored.

## Secrets at a glance

| Secret | Where it comes from |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | `wrangler whoami` or Cloudflare dashboard |
| `CHROME_EXTENSION_ID` | Chrome Web Store item URL/dashboard |
| `CHROME_PUBLISHER_ID` | Chrome Web Store publisher settings / dashboard URL |
| `CHROME_SERVICE_ACCOUNT_EMAIL` | Google Cloud service account |
| `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | Service-account JSON `private_key` (PEM) |
| `FIREFOX_EXTENSION_ID` | `savetabs@azcom.dev` (must match the manifest) |
| `FIREFOX_JWT_ISSUER` | AMO Developer Hub → API keys |
| `FIREFOX_JWT_SECRET` | AMO Developer Hub → API keys |

The repository variable `SAVETABS_NOTES_URL` is not a secret and is already
configured as `https://savetabs.azcom.dev`.

## Chrome Web Store (API v2 + service account)

Chrome Web Store API v1.1 stopped being supported on **2026-10-15**; the
workflow uses v2 with a service account.

### 1. Prepare the listing

1. Register a Chrome Web Store developer account (one-time fee) and create the
   SaveTabs listing.
2. Copy the **extension ID** from the dashboard URL:
   `https://chrome.google.com/webstore/devconsole/<publisher-id>/<extension-id>`
   → `CHROME_EXTENSION_ID`.
3. The **publisher ID** is the UUID in the same URL (or Publisher → Settings)
   → `CHROME_PUBLISHER_ID`.
4. API v2 cannot create the first item or edit listing metadata. The listing,
   package, screenshots and privacy answers are dashboard-only.

### 2. Create the service account

1. Open Google Cloud Console, create/select a project.
2. APIs & Services → Library → enable **Chrome Web Store API**.
3. IAM & Admin → Service Accounts → Create service account. No IAM roles are
   needed.
4. Create a JSON key for it and download the file.
5. Chrome Web Store Developer Dashboard → **Account** → add the service
   account email. One service account per publisher.
6. Extract the two values:

```bash
jq -r '.client_email' service-account.json   # CHROME_SERVICE_ACCOUNT_EMAIL
jq -r '.private_key' service-account.json > chrome-service-account.pem
# CHROME_SERVICE_ACCOUNT_PRIVATE_KEY is the PEM file content
```

### 3. Add the secrets

```bash
gh secret set CHROME_EXTENSION_ID --body "<extension-id>"
gh secret set CHROME_PUBLISHER_ID --body "<publisher-uuid>"
gh secret set CHROME_SERVICE_ACCOUNT_EMAIL --body "<service-account-email>"
gh secret set CHROME_SERVICE_ACCOUNT_PRIVATE_KEY < chrome-service-account.pem
```

Do not flatten the PEM into one line with literal `\n`; store it as a
multi-line secret file.

### Optional local dry run

```bash
cd ~/Workingspace/SaveTabs
export CHROME_EXTENSION_ID="<extension-id>"
export CHROME_PUBLISHER_ID="<publisher-uuid>"
export CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL="<service-account-email>"
export CHROME_SERVICE_ACCOUNT_PRIVATE_KEY="$(jq -r '.private_key' service-account.json)"

pnpm --filter @savetabs/extension exec wxt submit \
  --dry-run \
  --chrome-api-version v2 \
  --chrome-zip "$PWD/apps/extension/.output/savetabs-0.2.4-chrome.zip"
```

Pass the PEM through the environment, not as a CLI flag: a PEM starts with
`-----`, which the argument parser treats as another option.

## Firefox Add-ons (AMO)

1. Sign in to https://addons.mozilla.org/developers/.
2. Create the SaveTabs add-on with ID `savetabs@azcom.dev` (must match
   `apps/extension/wxt.config.ts`).
3. Developer Hub → **Tools** → **Manage API Keys** → generate credentials:
   - `FIREFOX_JWT_ISSUER` = JWT issuer
   - `FIREFOX_JWT_SECRET` = JWT secret
4. `FIREFOX_EXTENSION_ID=savetabs@azcom.dev`.

```bash
gh secret set FIREFOX_EXTENSION_ID --body "savetabs@azcom.dev"
gh secret set FIREFOX_JWT_ISSUER --body "<issuer>"
gh secret set FIREFOX_JWT_SECRET --body "<secret>"
```

The workflow uploads the Firefox ZIP plus the sources ZIP for review.

## Cloudflare (for the Release workflow)

The Worker and web Worker are already deployed manually; the workflow still
needs these secrets for future tag releases.

1. Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom.
2. Permissions:
   - Account → Workers Scripts: **Edit**
   - Account → Workers R2 Storage: **Edit**
   - Account → D1: **Edit**
   - Account → Account Settings: **Read**
   - Zone → Workers Routes: **Edit**
   - Zone → Zone: **Read**
3. Copy the token once; copy the account ID from `pnpm --filter
   @savetabs/worker exec wrangler whoami`.

```bash
gh secret set CLOUDFLARE_API_TOKEN --body "<token>"
gh secret set CLOUDFLARE_ACCOUNT_ID --body "<account-id>"
```

## First release after secrets are added

1. Make sure the store listings exist and the package/listing images are
   ready.
2. Push a version tag that matches the package version:
   ```bash
   git tag v0.2.2
   git push origin v0.2.2
   ```
3. The Release workflow builds, deploys Worker/web, uploads R2, then submits
   Chrome/Firefox. Check the run in GitHub Actions.
4. Only after the store accepts 0.2.2, publish the update manifest (the repo
   `versions.json` is already 0.2.2):
   ```bash
   cp versions.json apps/web/public/versions.json
   VITE_API_BASE=https://savetabs-api.azcom.dev pnpm --filter @savetabs/web build
   pnpm --filter @savetabs/worker exec wrangler deploy \
     --config apps/web/wrangler.toml
   pnpm --filter @savetabs/worker exec wrangler r2 object put \
     "savetabs-releases/versions.json" --file "$PWD/versions.json" \
     --content-type application/json --cache-control "public, max-age=300" --remote
   ```

## Security

- Never commit service-account JSON, PEM keys, refresh tokens, or API keys.
- Rotate a key immediately if it leaks; remove the service account from the
  Chrome publisher account if needed.
- GitHub Actions secret values are masked in logs, but the private key is
  multi-line: always set it from a file.
