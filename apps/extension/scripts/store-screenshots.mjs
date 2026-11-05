#!/usr/bin/env node
/**
 * Generates Chrome Web Store screenshots (1280x800 PNG) from the built
 * extension in `.output/chrome-mv3`.
 *
 * The script drives the real extension in a throwaway Chromium profile:
 * demo tabs are served from local route stubs (no network), saved through the
 * toolbar popup, and then the sessions page, options page and a composed
 * popup hero are captured. Run `pnpm build` with the production API base
 * first so the packaged manifest matches what ships:
 *
 *   WXT_SAVETABS_API_BASE=https://savetabs-api.azcom.dev pnpm build
 *   pnpm screenshots
 */
import { chromium } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const extensionDir = path.resolve(import.meta.dirname, "..");
const buildDir = path.join(extensionDir, ".output/chrome-mv3");
const outputDir = path.join(extensionDir, "store/screenshots");
const profileDir = path.join(extensionDir, ".output/.store-screenshot-profile");

/** Two demo sessions so the sessions page shows a realistic list. */
const DEMO_SESSIONS = [
  [
    { url: "https://linear.app/method", title: "Linear Method — Building products" },
    { url: "https://raycast.com/blog", title: "Raycast Blog — Supercharged productivity" },
    { url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript", title: "JavaScript | MDN" },
    { url: "https://github.com/features/actions", title: "GitHub Actions · Automate your workflow" },
    { url: "https://news.ycombinator.com/item?id=1", title: "Show HN: A faster way to read the web" },
  ],
  [
    { url: "https://www.figma.com/community", title: "Figma Community — Explore files and plugins" },
    { url: "https://stripe.com/docs/payments", title: "Stripe Payments — Documentation" },
    { url: "https://www.notion.so/product", title: "Notion — Your connected workspace" },
    { url: "https://tailwindcss.com/docs", title: "Tailwind CSS — Utility-first CSS" },
  ],
];

/** Minimal HTML stub so each demo tab has a real title without network. */
function stubPage(title) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body></body></html>`;
}

async function extensionId(context) {
  const existing = context.serviceWorkers()[0];
  const worker = existing ?? (await context.waitForEvent("serviceworker", { timeout: 20000 }));
  return new URL(worker.url()).host;
}

async function openDemoTabs(context, tabs) {
  const titles = new Map(tabs.map((tab) => [tab.url, tab.title]));
  await context.route("**/*", async (route) => {
    const title = titles.get(route.request().url());
    if (title === undefined) return route.continue();
    await route.fulfill({ status: 200, contentType: "text/html", body: stubPage(title) });
  });

  for (const tab of tabs) {
    const page = await context.newPage();
    await page.goto(tab.url, { waitUntil: "domcontentloaded" });
  }
  await context.unroute("**/*");
}

/** Saves the open tabs through the real popup UI. */
async function saveFromPopup(context, id) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  const saveButton = page.getByRole("button", { name: /^Save \d+ tabs$/ });
  await saveButton.waitFor({ timeout: 15000 });
  await saveButton.click();

  // The default confirm threshold (20) is above the demo tab count, but a
  // dialog would still gate the save if settings ever change.
  const confirmButton = page.getByRole("button", { name: "Save and close" });
  if (await confirmButton.isVisible().catch(() => false)) {
    await confirmButton.click();
  }

  await page.getByText(/Saved \d+ tabs\./).waitFor({ timeout: 15000 });
  await page.close();
}

/** Replaces a popup tab with a 1280x800 marketing frame around the popup. */
async function capturePopupHero(context, id, file) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);

  await page.evaluate(() => {
    document.body.innerHTML = "";
    document.head.querySelector("style")?.remove();
    const style = document.createElement("style");
    style.textContent = `
      html, body { width: 1280px; height: 800px; margin: 0; overflow: hidden; }
      body {
        display: grid; place-items: center;
        background:
          radial-gradient(900px 520px at 18% -8%, rgba(99, 102, 241, 0.42), transparent 62%),
          radial-gradient(760px 460px at 96% 108%, rgba(14, 165, 233, 0.30), transparent 60%),
          #0a0d14;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #f8fafc;
      }
      .stage { display: flex; align-items: center; gap: 96px; }
      .copy { max-width: 520px; }
      .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 34px; }
      .brand img { width: 52px; height: 52px; border-radius: 14px; }
      .brand span { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
      h1 {
        margin: 0 0 22px; font-size: 54px; line-height: 1.04;
        letter-spacing: -0.035em; font-weight: 800;
      }
      h1 em { font-style: normal; color: #a5b4fc; }
      p { margin: 0; font-size: 21px; line-height: 1.55; color: #94a3b8; }
      .card {
        width: 360px; height: 420px; border-radius: 22px; overflow: hidden;
        box-shadow: 0 40px 90px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(148, 163, 184, 0.22);
        background: #ffffff;
      }
      .card iframe { width: 360px; height: 420px; border: 0; display: block; }
    `;
    document.head.append(style);

    const stage = document.createElement("div");
    stage.className = "stage";
    stage.innerHTML = `
      <div class="copy">
        <div class="brand">
          <img src="icon/icon-128.png" alt="">
          <span>SaveTabs</span>
        </div>
        <h1>Save every tab.<br><em>Close the clutter.</em></h1>
        <p>One click stores your window as a session. Restore it later — end-to-end encrypted sync keeps it on every device.</p>
      </div>
      <div class="card"><iframe src="popup.html" title="SaveTabs popup"></iframe></div>
    `;
    document.body.append(stage);
  });

  const frame = page.locator(".card iframe");
  await frame.contentFrame().getByRole("button", { name: /Save \d+ tabs/ }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: file });
  await page.close();
}

await rm(profileDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  // The default headless shell does not support extensions; the "chromium"
  // channel selects the full browser in new headless mode.
  channel: "chromium",
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${buildDir}`, `--load-extension=${buildDir}`],
});

try {
  const id = await extensionId(context);
  console.log(`extension id: ${id}`);

  for (const tabs of DEMO_SESSIONS) {
    await openDemoTabs(context, tabs);
    await saveFromPopup(context, id);
  }

  const sessions = await context.newPage();
  await sessions.setViewportSize({ width: 1280, height: 800 });
  await sessions.goto(`chrome-extension://${id}/sessions.html`);
  await sessions.getByPlaceholder("Search sessions…").waitFor({ timeout: 15000 });
  await sessions.getByText("Saved sessions").waitFor();

  // Give the demo sessions readable names, then reload so the rename toast is
  // gone and every card can be expanded for the capture.
  const cardLocator = () =>
    sessions.locator("section").filter({ has: sessions.getByRole("button", { name: "Restore", exact: true }) });
  const names = ["Design references", "Reading list"];
  for (const [index, name] of names.entries()) {
    const card = cardLocator().nth(index);
    await card.getByRole("button", { name: "More actions" }).click();
    await card.getByRole("menuitem", { name: "Rename" }).click();
    await card.getByRole("textbox", { name: "Session name" }).fill(name);
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await sessions.getByText("Session renamed.").waitFor();
  }
  await sessions.reload();
  await sessions.getByPlaceholder("Search sessions…").waitFor({ timeout: 15000 });
  const expandButtons = sessions.getByRole("button", { name: "Show tabs", exact: true });
  while ((await expandButtons.count()) > 0) await expandButtons.first().click();
  await sessions.waitForTimeout(400);
  await sessions.screenshot({ path: path.join(outputDir, "01-sessions.png") });
  console.log("captured 01-sessions.png");

  const options = await context.newPage();
  await options.setViewportSize({ width: 1280, height: 800 });
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByPlaceholder("Search settings…").waitFor({ timeout: 15000 });
  // Open two categories so the capture shows real controls, not just headers.
  await options.locator("#settings-section-general-header").click();
  await options.locator("#settings-section-duplicates-header").click();
  // Fit both open sections above the fold without clipping the last row.
  await options.evaluate(() => {
    document.documentElement.style.zoom = "0.9";
  });
  await options.waitForTimeout(400);
  await options.screenshot({ path: path.join(outputDir, "02-options.png") });
  console.log("captured 02-options.png");

  // The hero popup reports the save scope of the current window, so leave a
  // few demo tabs open while it renders.
  await openDemoTabs(context, [
    { url: "https://www.anthropic.com/research", title: "Anthropic — Research" },
    { url: "https://vitejs.dev/guide/", title: "Vite — Getting started" },
    { url: "https://www.typescriptlang.org/docs/", title: "TypeScript — Documentation" },
    { url: "https://developer.chrome.com/docs/extensions", title: "Chrome Extensions — Documentation" },
  ]);
  await capturePopupHero(context, id, path.join(outputDir, "03-popup.png"));
  console.log("captured 03-popup.png");
} finally {
  await context.close();
  await rm(profileDir, { recursive: true, force: true });
}
