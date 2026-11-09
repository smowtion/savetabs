#!/usr/bin/env node
/**
 * Cancel the Chrome Web Store submission that is currently in review.
 *
 * The Chrome Web Store refuses any upload while a previous version is being
 * reviewed (NOT_UPDATEABLE). Cancelling the pending submission returns it to a
 * draft, so the release workflow can upload the next version in the same run.
 *
 * The script authenticates as the same service account the release workflow
 * already uses, so no interactive Google sign-in is involved. It reads:
 *   CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL
 *   CHROME_SERVICE_ACCOUNT_PRIVATE_KEY
 *   CHROME_PUBLISHER_ID
 *   CHROME_EXTENSION_ID
 *
 * Nothing in this script prints the token or the private key.
 *
 * Usage: node scripts/cancel-chrome-submission.mjs
 */
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";

/** Read a required env var, failing with the variable name (never its value). */
function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`missing required environment variable ${name}`);
  }
  return value;
}

/** JWT segment encoding without padding, as Google expects. */
function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

/** Build the signed service-account assertion for the OAuth token exchange. */
function buildAssertion(email, privateKey) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

/** Exchange the assertion for an access token. */
async function fetchAccessToken(email, privateKey) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildAssertion(email, privateKey),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = body.error_description ?? body.error ?? "unknown error";
    throw new Error(`token exchange failed (${response.status}): ${reason}`);
  }
  if (typeof body.access_token !== "string" || body.access_token === "") {
    throw new Error("token exchange returned no access_token");
  }
  return body.access_token;
}

/** Pull the human-readable message out of a Google API error body. */
function errorMessage(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message ?? body;
  } catch {
    return body;
  }
}

async function main() {
  const email = requiredEnv("CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL");
  const privateKey = requiredEnv("CHROME_SERVICE_ACCOUNT_PRIVATE_KEY").replace(
    /\\n/g,
    "\n",
  );
  const publisherId = requiredEnv("CHROME_PUBLISHER_ID");
  const extensionId = requiredEnv("CHROME_EXTENSION_ID");

  const token = await fetchAccessToken(email, privateKey);
  const url =
    "https://chromewebstore.googleapis.com/v2/publishers/" +
    `${encodeURIComponent(publisherId)}/items/` +
    `${encodeURIComponent(extensionId)}:cancelSubmission`;
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });

  if (response.ok) {
    console.log(
      `cancel-chrome-submission: canceled the pending submission for ${extensionId}`,
    );
    return;
  }

  const message = errorMessage(await response.text());
  // Nothing pending is the desired state for an optional step, not an error.
  if (
    response.status === 404 ||
    /no (active |pending )?submission|not (in|under) review|no .*review/i.test(
      message,
    )
  ) {
    console.log(
      `cancel-chrome-submission: nothing in review for ${extensionId}; continuing`,
    );
    return;
  }
  throw new Error(`cancelSubmission failed (${response.status}): ${message}`);
}

main().catch((error) => {
  console.error(`cancel-chrome-submission: ${error.message}`);
  process.exitCode = 1;
});
