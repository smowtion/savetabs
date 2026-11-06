import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  deriveKeys,
  generateKey,
  parseKey,
} from "@savetabs/shared/crypto/key";
import { encryptSession } from "@savetabs/shared/crypto/session-cipher";
import type { Session } from "@savetabs/shared/types";

/**
 * End-to-end smoke tests for the SaveTabs web app.
 *
 * The sync API is mocked at the network layer so the tests stay hermetic and
 * never need a Worker or D1 instance. Fixtures are encrypted with the same
 * shared crypto the app uses, which proves the page decrypts real base64url
 * blobs rather than a hand-written stand-in.
 *
 * The mock follows the Worker's real failure semantics:
 * - an authenticated read for an authId with no key row returns 404;
 * - a registered key presented with a different bearer returns 401.
 * Because the authId is derived from the key, a mistyped key is always a
 * different vault, so 404 is the normal wrong-key outcome, never 401.
 */

const SESSION_TITLE = "Morning reading";
const TAB_TITLES = ["Example A", "Docs B"] as const;

const FULL_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self' https://api.savetabs.example; " +
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self';";

/** Headers required by Chromium for a cross-origin fetch with a bearer token. */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization",
};

type Fixture = {
  syncKey: string;
  authId: string;
  authKey: string;
  blob: { id: string; ciphertext: string; updatedAt: number };
};

/** What the mocked server should do for the fixture key's list request. */
type ApiMode = "serve" | "auth-mismatch";

/** Values observed by the mock, asserted by the tests. */
type ApiObservation = {
  authorization: string | null;
};

/** Build one session and encrypt it exactly as the extension would. */
async function createFixture(): Promise<Fixture> {
  const syncKey = generateKey();
  const { authId, authKey, encKey } = await deriveKeys(parseKey(syncKey));
  const session: Session = {
    id: crypto.randomUUID(),
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    title: SESSION_TITLE,
    source: "window",
    tabs: [
      { url: "https://example.com/a", title: TAB_TITLES[0] },
      { url: "https://docs.example.com/b", title: TAB_TITLES[1] },
    ],
  };

  return {
    syncKey,
    authId,
    authKey,
    blob: {
      id: session.id,
      ciphertext: await encryptSession(encKey, authId, session),
      updatedAt: session.updatedAt,
    },
  };
}

/**
 * Serve the list endpoint for the fixture key and mirror the Worker for every
 * other request: unknown authIds get 404, while `auth-mismatch` makes the
 * registered fixture key answer 401 for a bearer that does not match.
 */
async function mockSyncApi(
  page: Page,
  fixture: Fixture,
  mode: ApiMode = "serve",
): Promise<ApiObservation> {
  const observed: ApiObservation = { authorization: null };

  await page.route("**/v1/keys/**", async (route) => {
    const request = route.request();

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }

    const { pathname } = new URL(request.url());
    const listPath = `/v1/keys/${fixture.authId}/blobs`;

    if (request.method() === "GET" && pathname === listPath) {
      observed.authorization =
        request.headers()["authorization"] ?? null;

      if (mode === "auth-mismatch") {
        await route.fulfill({
          status: 401,
          headers: CORS_HEADERS,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "unauthorized",
              message: "A valid bearer token is required.",
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        headers: CORS_HEADERS,
        contentType: "application/json",
        body: JSON.stringify({ blobs: [fixture.blob] }),
      });
      return;
    }

    // Authenticated reads for an authId with no key row are 404 in the Worker.
    await route.fulfill({
      status: 404,
      headers: CORS_HEADERS,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "not_found", message: "Sync key not found." },
      }),
    });
  });

  return observed;
}

async function enterKey(page: Page, syncKey: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Sync key").fill(syncKey);
  await page.getByRole("button", { name: "Continue" }).click();
}

test("opens a session with the sync key and decrypts its tab titles", async ({
  page,
}) => {
  const fixture = await createFixture();
  const api = await mockSyncApi(page, fixture);

  await enterKey(page, fixture.syncKey);

  await expect(page).toHaveURL(/\/sessions$/);
  await expect(
    page.getByRole("heading", { name: SESSION_TITLE }),
  ).toBeVisible();
  for (const title of TAB_TITLES) {
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  }
  await expect(page.getByText("2 tabs")).toBeVisible();
  expect(api.authorization).toBe(`Bearer ${fixture.authKey}`);
});

test("shows the no-data state for an unknown key instead of an auth error", async ({
  page,
}) => {
  const fixture = await createFixture();
  await mockSyncApi(page, fixture);

  await enterKey(page, generateKey());

  await expect(
    page.getByRole("heading", { name: "No synced data for this key" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Check that you entered it correctly/i),
  ).toBeVisible();
  await expect(page.getByText("No sessions yet")).toHaveCount(0);
  await expect(page.getByText("Your sync key was rejected")).toHaveCount(0);

  await page.getByRole("button", { name: "Change key" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Open your saved tabs" }),
  ).toBeVisible();
});

test("shows an auth error when a registered key receives the wrong bearer", async ({
  page,
}) => {
  const fixture = await createFixture();
  await mockSyncApi(page, fixture, "auth-mismatch");

  await enterKey(page, fixture.syncKey);

  await expect(page.getByRole("alert")).toContainText(
    "Your sync key was rejected",
  );
  await expect(page.getByText("No synced data for this key")).toHaveCount(0);
  await expect(page.getByText("No sessions yet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change key" })).toBeVisible();
});

test("serves the privacy policy with its data-handling details", async ({
  page,
}) => {
  await page.goto("/privacy");

  await expect(
    page.getByRole("heading", { level: 1, name: "Privacy policy" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What the sync server stores" }),
  ).toBeVisible();
  await expect(
    page.getByText("The sync server stores the following data for your key:"),
  ).toBeVisible();
  await expect(
    page.getByText(/rate-limit records keyed by client IP address and authId/i),
  ).toBeVisible();
  await expect(page.getByText("support@azcom.dev")).toBeVisible();
});

test("Arabic stays within a 360px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.getByLabel(/language/i).selectOption("ar");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
});

test("ships the Cloudflare Pages security headers", async () => {
  const headersPath = fileURLToPath(new URL("../dist/_headers", import.meta.url));
  const headers = await readFile(headersPath, "utf8");

  expect(headers).toContain(`Content-Security-Policy: ${FULL_CSP}`);
  expect(headers).toContain("X-Content-Type-Options: nosniff");
  expect(headers).toContain("Referrer-Policy: strict-origin-when-cross-origin");
  expect(headers).toContain(
    "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()",
  );
});
