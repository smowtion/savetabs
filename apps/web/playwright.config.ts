import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke tests for the built web app.
 *
 * Playwright builds the production bundle and serves it through `vite preview`,
 * so every run exercises the same assets a Cloudflare Pages deploy ships. The
 * bundled Chromium is used by default; set `PW_CHANNEL=chrome` to fall back to
 * a system Chrome install when the browser download is unavailable.
 */

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    channel: process.env.PW_CHANNEL || undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
