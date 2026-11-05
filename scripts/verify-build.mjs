#!/usr/bin/env node
/**
 * Verifies that both production extension builds are shippable.
 *
 * Run after `pnpm build:ext && pnpm zip:chrome && pnpm zip:firefox`. The
 * script checks the generated manifests, the icon set rendered from
 * `assets/icon.svg`, and the store ZIPs produced by WXT. Every check runs so a
 * single run reports all problems; the process exits non-zero if any failed.
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_DIR = resolve(ROOT, "apps/extension");
const OUTPUT_DIR = resolve(EXTENSION_DIR, ".output");
const SOURCE_ICON_DIR = resolve(EXTENSION_DIR, "public/icon");

const ICON_SIZES = [16, 32, 48, 128];
const REQUIRED_COMMANDS = ["save-tabs", "open-sessions", "discard-now"];
// A real build is ~120 kB; anything this small means the archive is empty or
// truncated (for example a failed build leaving a partial ZIP behind).
const MIN_ZIP_BYTES = 10_000;

const BROWSERS = [
  { name: "chrome", outputDir: "chrome-mv3", requiresGecko: false },
  { name: "firefox", outputDir: "firefox-mv3", requiresGecko: true },
];

const failures = [];

/** Record a failure without aborting the remaining checks. */
function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

/** Read and parse a JSON file, recording a failure instead of throwing. */
async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    failures.push(`${label}: cannot read ${path} (${error.message})`);
    return null;
  }
}

/** Assert a file exists and is a PNG with exact square dimensions. */
async function checkPng(path, size, label) {
  try {
    const metadata = await sharp(path).metadata();
    check(metadata.format === "png", `${label}: expected PNG, found ${metadata.format}`);
    check(
      metadata.width === size && metadata.height === size,
      `${label}: expected ${size}x${size}, found ${metadata.width}x${metadata.height}`,
    );
  } catch (error) {
    failures.push(`${label}: cannot read ${path} (${error.message})`);
  }
}

/** Verify every manifest icon path resolves to a PNG of the right size. */
async function checkManifestIcons(manifest, outputDir, label) {
  const icons = manifest?.icons;
  check(
    icons !== null && typeof icons === "object" && !Array.isArray(icons),
    `${label}: manifest has no "icons" object`,
  );
  if (icons === null || typeof icons !== "object" || Array.isArray(icons)) {
    return;
  }

  for (const size of ICON_SIZES) {
    const iconPath = icons[size];
    check(
      typeof iconPath === "string" && iconPath.length > 0,
      `${label}: manifest "icons" is missing the ${size}px entry`,
    );
    if (typeof iconPath !== "string" || iconPath.length === 0) {
      continue;
    }
    check(!iconPath.startsWith("/"), `${label}: icon path "${iconPath}" must be relative`);
    await checkPng(resolve(outputDir, iconPath), size, `${label} icon ${size}px`);
  }

  const actionIcon = manifest?.action?.default_icon;
  check(
    actionIcon !== null && typeof actionIcon === "object",
    `${label}: action.default_icon is missing`,
  );
  if (actionIcon === null || typeof actionIcon !== "object") {
    return;
  }
  for (const size of ICON_SIZES) {
    check(
      actionIcon[size] === icons[size],
      `${label}: action.default_icon must reference the ${size}px icon`,
    );
  }
}

for (const size of ICON_SIZES) {
  await checkPng(
    resolve(SOURCE_ICON_DIR, `icon-${size}.png`),
    size,
    `source icon ${size}px`,
  );
}

let zipVersion = null;

for (const browser of BROWSERS) {
  const outputDir = resolve(OUTPUT_DIR, browser.outputDir);
  const manifestPath = resolve(outputDir, "manifest.json");
  const label = `${browser.name} manifest`;
  const manifest = await readJson(manifestPath, label);
  if (manifest === null) {
    continue;
  }

  zipVersion ??= manifest.version;
  check(manifest.manifest_version === 3, `${label}: expected manifest_version 3`);
  check(
    manifest.action !== null &&
      typeof manifest.action === "object" &&
      !Array.isArray(manifest.action),
    `${label}: manifest has no "action" object`,
  );
  check(
    manifest.commands !== null &&
      typeof manifest.commands === "object" &&
      !Array.isArray(manifest.commands),
    `${label}: manifest has no "commands" object`,
  );
  for (const command of REQUIRED_COMMANDS) {
    check(
      manifest.commands !== null &&
        typeof manifest.commands === "object" &&
        command in manifest.commands,
      `${label}: missing "${command}" command`,
    );
  }

  await checkManifestIcons(manifest, outputDir, label);

  if (browser.requiresGecko) {
    const gecko = manifest?.browser_specific_settings?.gecko;
    check(
      gecko !== null && typeof gecko === "object",
      `${label}: missing browser_specific_settings.gecko`,
    );
    check(
      typeof gecko?.id === "string" && gecko.id.length > 0,
      `${label}: browser_specific_settings.gecko.id is missing`,
    );
    // AMO rejects new Firefox extensions without this declaration.
    check(
      gecko?.data_collection_permissions !== null &&
        typeof gecko?.data_collection_permissions === "object" &&
        Array.isArray(gecko.data_collection_permissions?.required) &&
        gecko.data_collection_permissions.required.length > 0,
      `${label}: browser_specific_settings.gecko.data_collection_permissions.required is missing`,
    );
  }
}

check(
  typeof zipVersion === "string" && zipVersion.length > 0,
  "cannot determine the extension version from the generated manifests",
);

for (const browser of BROWSERS) {
  if (typeof zipVersion !== "string" || zipVersion.length === 0) {
    break;
  }
  const zipPath = resolve(OUTPUT_DIR, `savetabs-${zipVersion}-${browser.name}.zip`);
  try {
    const info = await stat(zipPath);
    check(
      info.isFile() && info.size > MIN_ZIP_BYTES,
      `${browser.name} zip: ${zipPath} is ${info.size} bytes, expected more than ${MIN_ZIP_BYTES}`,
    );
  } catch (error) {
    failures.push(`${browser.name} zip: cannot read ${zipPath} (${error.message})`);
  }
}

if (failures.length > 0) {
  console.error(`verify-build: ${failures.length} check(s) failed:`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(
  `verify-build: OK - chrome and firefox manifests, ${ICON_SIZES.join("/")}px icons, and savetabs-${zipVersion}-{chrome,firefox}.zip`,
);
