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
 */

const SESSION_TITLE = "Morning reading";
const TAB_TITLES = ["Example A", "Docs B"] as const;

/** Headers required by Chromium for a cross-origin fetch with a bearer token. */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization",
};

type Fixture = {
  syncKey: string;
  authId: string;
  blob: { id: string; ciphertext: string; updatedAt: number };
};

/** Build one session and encrypt it exactly as the extension would. */
async function createFixture(): Promise<Fixture> {
  const syncKey = generateKey();
  const { authId, encKey } = await deriveKeys(parseKey(syncKey));
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
    blob: {
      id: session.id,
      ciphertext: await encryptSession(encKey, authId, session),
      updatedAt: session.updatedAt,
    },
  };
}

/**
 * Serve the list endpoint for the fixture key and reject every other key with
 * 401, mirroring the Worker's bearer check. Requests are answered with CORS
 * headers because the app talks to `https://api.savetabs.example`.
 */
async function mockSyncApi(page: Page, fixture: Fixture): Promise<void> {
  await page.route("**/v1/keys/**", async (route) => {
    const request = route.request();

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }

    const { pathname } = new URL(request.url());
    if (
      request.method() === "GET" &&
      pathname === `/v1/keys/${fixture.authId}/blobs`
    ) {
      await route.fulfill({
        status: 200,
        headers: CORS_HEADERS,
        contentType: "application/json",
        body: JSON.stringify({ blobs: [fixture.blob] }),
      });
      return;
    }

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
  });
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
  await mockSyncApi(page, fixture);

  await enterKey(page, fixture.syncKey);

  await expect(page).toHaveURL(/\/sessions$/);
  await expect(
    page.getByRole("heading", { name: SESSION_TITLE }),
  ).toBeVisible();
  for (const title of TAB_TITLES) {
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  }
  await expect(page.getByText("2 tabs")).toBeVisible();
});

test("shows an auth error instead of the empty state when the key is rejected", async ({
  page,
}) => {
  const fixture = await createFixture();
  await mockSyncApi(page, fixture);

  await enterKey(page, generateKey());

  await expect(page.getByRole("alert")).toContainText(
    "Your sync key was rejected",
  );
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
  await expect(page.getByText("contact@savetabs.example")).toBeVisible();
});

test("ships the Cloudflare Pages security headers", async () => {
  const headersPath = fileURLToPath(new URL("../dist/_headers", import.meta.url));
  const headers = await readFile(headersPath, "utf8");

  expect(headers).toContain("default-src 'self'");
  expect(headers).toContain("script-src 'self'");
  expect(headers).toContain("connect-src 'self' https://api.savetabs.example");
  expect(headers).toContain("frame-ancestors 'none'");
  expect(headers).toContain("X-Content-Type-Options: nosniff");
  expect(headers).toContain("Referrer-Policy: strict-origin-when-cross-origin");
});
