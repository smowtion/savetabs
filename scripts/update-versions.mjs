#!/usr/bin/env node
/**
 * Keeps versions.json in sync with the extension and worker package versions.
 *
 * versions.json is uploaded to the R2 release bucket by the release workflow
 * and served by `GET /v1/version`. The extension and worker versions must
 * match because the manifest publishes one version pair for both browsers;
 * a divergence usually means one side of a release bump was forgotten.
 *
 * Usage:
 *   node scripts/update-versions.mjs           # rewrite versions.json
 *   node scripts/update-versions.mjs --check   # verify only, never write
 *
 * `--check` fails when the two package versions diverge or when versions.json
 * is missing, malformed, or no longer matches the packages. It performs no
 * network access and writes no files.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_PACKAGE = resolve(ROOT, "apps/extension/package.json");
const WORKER_PACKAGE = resolve(ROOT, "apps/worker/package.json");
const VERSIONS_FILE = resolve(ROOT, "versions.json");

/**
 * Release-notes URL used when SAVETABS_NOTES_URL is not set. The Pages
 * project hosting the web app is the natural home for per-version notes.
 */
const DEFAULT_NOTES_BASE = "https://savetabs.pages.dev/releases";

/** Read and validate the version field of a workspace package. */
async function readPackageVersion(path, label) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read the ${label} package at ${path}: ${error.message}`);
  }

  if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
    throw new Error(`${path} has no usable "version" field`);
  }
  return manifest.version.trim();
}

/**
 * Read the existing manifest. A missing, unreadable or malformed file is
 * treated as absent so the write path can regenerate it; --check reports the
 * difference instead of writing.
 */
async function readExistingVersions() {
  let raw;
  try {
    raw = await readFile(VERSIONS_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`cannot read ${VERSIONS_FILE}: ${error.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** True when both browser entries exist and both equal the package version. */
function matchesVersion(extension, version) {
  return (
    typeof extension === "object" &&
    extension !== null &&
    !Array.isArray(extension) &&
    extension.chrome === version &&
    extension.firefox === version
  );
}

/** True when the existing file already describes the expected manifest. */
function matchesManifest(existing, expected) {
  return (
    matchesVersion(existing?.extension, expected.extension.chrome) &&
    existing.notesUrl === expected.notesUrl &&
    existing.updatedAt === expected.updatedAt
  );
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const unknown = args.filter((argument) => argument !== "--check");
  if (unknown.length > 0) {
    throw new Error(
      `unknown argument(s): ${unknown.join(", ")} (usage: node scripts/update-versions.mjs [--check])`,
    );
  }

  const extensionVersion = await readPackageVersion(EXTENSION_PACKAGE, "extension");
  const workerVersion = await readPackageVersion(WORKER_PACKAGE, "worker");
  if (extensionVersion !== workerVersion) {
    throw new Error(
      `version mismatch: apps/extension/package.json is ${extensionVersion} but ` +
        `apps/worker/package.json is ${workerVersion}; bump both to the same semver`,
    );
  }

  const configuredNotesUrl = process.env.SAVETABS_NOTES_URL?.trim();
  const notesUrl =
    configuredNotesUrl && configuredNotesUrl.length > 0
      ? configuredNotesUrl
      : `${DEFAULT_NOTES_BASE}/${extensionVersion}`;

  let parsedNotesUrl;
  try {
    parsedNotesUrl = new URL(notesUrl);
  } catch {
    throw new Error(
      `notes URL "${notesUrl}" is not a valid absolute URL; ` +
        "set SAVETABS_NOTES_URL to an absolute http(s) URL",
    );
  }
  if (parsedNotesUrl.protocol !== "http:" && parsedNotesUrl.protocol !== "https:") {
    throw new Error(`notes URL "${notesUrl}" must use http or https`);
  }

  const existing = await readExistingVersions();
  const unchanged =
    existing !== null &&
    matchesVersion(existing.extension, extensionVersion) &&
    existing.notesUrl === notesUrl &&
    typeof existing.updatedAt === "number" &&
    Number.isFinite(existing.updatedAt);

  const expected = {
    extension: { chrome: extensionVersion, firefox: extensionVersion },
    notesUrl,
    // Reuse the previous timestamp when nothing changed so repeated runs do
    // not create diff noise. Any version or notes change gets a fresh stamp.
    updatedAt: unchanged ? existing.updatedAt : Date.now(),
  };

  if (checkOnly) {
    if (existing === null) {
      throw new Error(
        "versions.json is missing or invalid; run " +
          `"node scripts/update-versions.mjs" to regenerate it`,
      );
    }
    if (!matchesManifest(existing, expected)) {
      throw new Error(
        `versions.json is out of date (expected extension ${extensionVersion}/${extensionVersion} ` +
          `and notes ${notesUrl}); run "node scripts/update-versions.mjs" to regenerate it`,
      );
    }
    console.log(
      `update-versions: OK - versions.json matches extension ${extensionVersion} and worker ${workerVersion}`,
    );
    return;
  }

  const serialized = `${JSON.stringify(expected, null, 2)}\n`;
  const current =
    existing === null ? null : `${JSON.stringify(existing, null, 2)}\n`;
  if (current === serialized) {
    console.log(
      `update-versions: versions.json already up to date (${extensionVersion})`,
    );
    return;
  }

  await writeFile(VERSIONS_FILE, serialized);
  console.log(
    `update-versions: wrote ${VERSIONS_FILE} (extension ${extensionVersion}, worker ${workerVersion})`,
  );
}

main().catch((error) => {
  console.error(`update-versions: ${error.message}`);
  process.exitCode = 1;
});
