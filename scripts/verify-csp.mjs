#!/usr/bin/env node
/**
 * Release guard: the built web app's CSP must allow the configured API origin.
 *
 * The Pages `_headers` file is static, so a release could silently ship a CSP
 * whose `connect-src` does not include the deployed Worker. This script fails
 * closed unless:
 * - `VITE_API_BASE` is set, is an http(s) URL, and its origin appears in the
 *   built `apps/web/dist/_headers` `connect-src` directive;
 * - `WXT_SAVETABS_API_BASE`, when set, has the same origin as `VITE_API_BASE`.
 *
 * Usage:
 *   node scripts/verify-csp.mjs [--headers <path>]
 *
 * The pure `verifyCsp` helper is imported by `verify-csp.test.mjs`.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_HEADERS_PATH = resolve(ROOT, "apps/web/dist/_headers");

/** Return the first `Content-Security-Policy` value in a `_headers` file. */
export function findCspHeader(headersText) {
  for (const line of headersText.split(/\r?\n/)) {
    const match = /^\s*Content-Security-Policy\s*:\s*(.+?)\s*$/i.exec(line);
    if (match) return match[1];
  }
  return null;
}

/** Parse a CSP string into a map of directive name to source tokens. */
export function parseCspDirectives(csp) {
  const directives = new Map();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    directives.set(tokens[0].toLowerCase(), tokens.slice(1));
  }
  return directives;
}

/** Compare CSP source tokens against an origin, tolerating source forms. */
function sourceMatchesOrigin(source, origin) {
  if (source.toLowerCase() === origin.toLowerCase()) return true;
  try {
    return new URL(source).origin.toLowerCase() === origin.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Validate the release configuration.
 *
 * Returns an array of human-readable errors; an empty array means the CSP and
 * both build origins agree. Missing inputs are errors, never warnings.
 */
export function verifyCsp({ viteApiBase, wxtApiBase, headersText }) {
  const errors = [];
  const vite = (viteApiBase ?? "").trim();
  if (!vite) {
    return ["VITE_API_BASE is not set; the web build has no API origin."];
  }

  let viteUrl;
  try {
    viteUrl = new URL(vite);
  } catch {
    return [`VITE_API_BASE "${vite}" is not a valid absolute URL.`];
  }
  if (viteUrl.protocol !== "http:" && viteUrl.protocol !== "https:") {
    errors.push(`VITE_API_BASE "${vite}" must use http or https.`);
  }
  const viteOrigin = viteUrl.origin;

  const wxt = (wxtApiBase ?? "").trim();
  if (wxt) {
    try {
      const wxtOrigin = new URL(wxt).origin;
      if (wxtOrigin.toLowerCase() !== viteOrigin.toLowerCase()) {
        errors.push(
          `WXT_SAVETABS_API_BASE origin ${wxtOrigin} does not match VITE_API_BASE origin ${viteOrigin}.`,
        );
      }
    } catch {
      errors.push(
        `WXT_SAVETABS_API_BASE "${wxt}" is not a valid absolute URL.`,
      );
    }
  }

  const csp = findCspHeader(headersText);
  if (csp === null) {
    errors.push(
      "no Content-Security-Policy header found in the built _headers file.",
    );
    return errors;
  }

  const connectSrc = parseCspDirectives(csp).get("connect-src");
  if (connectSrc === undefined || connectSrc.length === 0) {
    errors.push(
      "the Content-Security-Policy has no connect-src directive; the web app could not reach the API.",
    );
    return errors;
  }

  if (!connectSrc.some((source) => sourceMatchesOrigin(source, viteOrigin))) {
    errors.push(
      `connect-src (${connectSrc.join(" ")}) does not allow the API origin ${viteOrigin}. ` +
        "Update apps/web/public/_headers with the real API domain and rebuild before releasing.",
    );
  }

  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  let headersPath = DEFAULT_HEADERS_PATH;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--headers") {
      const value = args[index + 1];
      if (value === undefined || value.length === 0) {
        throw new Error("--headers requires a path");
      }
      headersPath = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument "${argument}" (usage: verify-csp.mjs [--headers <path>])`);
  }

  let headersText;
  try {
    headersText = await readFile(headersPath, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${headersPath}: ${error.message}`);
  }

  const errors = verifyCsp({
    viteApiBase: process.env.VITE_API_BASE,
    wxtApiBase: process.env.WXT_SAVETABS_API_BASE,
    headersText,
  });

  if (errors.length > 0) {
    console.error(`verify-csp: ${errors.length} check(s) failed:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  const origin = new URL(process.env.VITE_API_BASE.trim()).origin;
  console.log(
    `verify-csp: OK - connect-src allows ${origin} and the build origins agree`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`verify-csp: ${error.message}`);
    process.exitCode = 1;
  });
}
