#!/usr/bin/env node
/**
 * Builds the source archive submitted to Mozilla Add-ons from the tracked
 * repository tree.
 *
 * AMO requires readable, reproducible source when the submitted package is
 * minified. WXT's own sources zip contains only apps/extension, which is not
 * enough for this pnpm monorepo: the extension imports the @savetabs/shared
 * workspace package, so the archive must also include packages/, the workspace
 * files and the lockfile.
 *
 * Usage:
 *   node scripts/package-sources.mjs
 *
 * Output: apps/extension/.output/savetabs-<version>-sources.zip
 */
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_PACKAGE = resolve(ROOT, "apps/extension/package.json");
const OUTPUT_DIR = resolve(ROOT, "apps/extension/.output");

/** Paths that the build needs; everything else (plans, docs, CI) is skipped. */
const INCLUDED_PATHS = [
  "apps/extension",
  "packages",
  "scripts",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "README.md",
];

const { version } = JSON.parse(await readFile(EXTENSION_PACKAGE, "utf8"));
if (typeof version !== "string" || version.length === 0) {
  throw new Error(`${EXTENSION_PACKAGE} has no usable "version" field`);
}

const outputPath = resolve(OUTPUT_DIR, `savetabs-${version}-sources.zip`);

// `git archive` exports exactly the tracked files, so node_modules, .output,
// local environment files and other untracked state can never leak into the
// archive AMO reviews.
execFileSync(
  "git",
  [
    "archive",
    "--format=zip",
    `--prefix=savetabs-${version}/`,
    `--output=${outputPath}`,
    "HEAD",
    "--",
    ...INCLUDED_PATHS,
  ],
  { cwd: ROOT, stdio: "inherit" },
);

const info = await stat(outputPath);
if (!info.isFile() || info.size === 0) {
  throw new Error(`source archive was not written: ${outputPath}`);
}

console.log(
  `package-sources: OK - ${outputPath} (${Math.round(info.size / 1024)} KiB)`,
);
