/**
 * Settings coverage.
 *
 * The schema is the single source of truth for the options UI, but every
 * setting must also be read by real behavior somewhere in the extension.
 * This test scans the extension's non-test source and fails with the exact
 * keys no code references, so a dead setting cannot ship silently.
 */

import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SETTING_KEYS } from "./settings-schema";

const EXTENSION_DIR = fileURLToPath(
  new URL("../../../apps/extension/", import.meta.url),
);

/** Directories that contain generated or vendored code, never source. */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".wxt",
  ".output",
  "dist",
  "coverage",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await collectSourceFiles(path)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
    if (isTestFile(entry.name)) continue;
    files.push(path);
  }

  return files;
}

describe("settings coverage", () => {
  it("references every setting key in extension source", async () => {
    const files = await collectSourceFiles(EXTENSION_DIR);
    expect(files.length).toBeGreaterThan(0);

    const contents = (
      await Promise.all(files.map((path) => readFile(path, "utf8")))
    ).join("\n");

    const missing = SETTING_KEYS.filter((key) => !contents.includes(key));
    expect(missing, `settings not used by any extension source file: ${missing.join(", ")}`).toEqual([]);
  });
});
