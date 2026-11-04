/**
 * Extension version check.
 *
 * A daily alarm reads the release manifest from the sync API and compares the
 * published version for this browser with `runtime.getManifest().version`.
 * The result is persisted in `storage.local` so the toolbar badge and the
 * update banner can react without another network request.
 *
 * Version comparison is numeric and segment-by-segment: `1.2.10` is newer than
 * `1.2.9`, and a prerelease suffix such as `-beta.1` is ignored. Every failure
 * (network, HTTP status, malformed JSON, missing browser entry) resolves to
 * `null`, so the background service worker can log it and keep running.
 */

import type { VersionInfo } from "@savetabs/shared";
import { browser } from "wxt/browser";

import { API_BASE } from "./config";
import { STORE_LISTING_URLS, type StoreBrowser } from "./store-urls";

/** Alarm that runs the daily update check. */
export const VERSION_CHECK_ALARM_NAME = "version-check";
/** How often the update check runs, matching the alarm period. */
export const VERSION_CHECK_PERIOD_MINUTES = 24 * 60;
/** Storage key holding whether a newer version is available. */
export const UPDATE_AVAILABLE_STORAGE_KEY = "updateAvailable";
/** Storage key holding the latest published version string. */
export const LATEST_VERSION_STORAGE_KEY = "latestVersion";

export type VersionCheckResult = {
  latest: string;
  current: string;
  updateAvailable: boolean;
};

export type UpdateState = {
  updateAvailable: boolean;
  latestVersion: string | null;
};

/** The browser this build targets; WXT sets `BROWSER` at build time. */
export function currentBrowser(): StoreBrowser {
  return import.meta.env.BROWSER === "firefox" ? "firefox" : "chrome";
}

/** Store listing for a browser. */
export function storeListingUrl(target: StoreBrowser): string {
  return STORE_LISTING_URLS[target];
}

/**
 * Split a version into numeric segments. A prerelease or build suffix is
 * dropped, and a value that is not a dot-separated number chain is rejected.
 */
function parseVersion(value: string): number[] | null {
  const match = /^(\d+(?:\.\d+)*)(?:[-+][0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (match === null) return null;

  const segments = match[1].split(".").map(Number);
  return segments.every(Number.isSafeInteger) ? segments : null;
}

/**
 * Compare two versions by numeric segments. Missing trailing segments count as
 * zero, so `1.2` and `1.2.0` are equal.
 */
function compareVersions(left: string, right: string): number | null {
  const leftSegments = parseVersion(left);
  const rightSegments = parseVersion(right);
  if (leftSegments === null || rightSegments === null) return null;

  const length = Math.max(leftSegments.length, rightSegments.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftSegments[index] ?? 0;
    const rightValue = rightSegments[index] ?? 0;
    if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1;
  }
  return 0;
}

function readInstalledVersion(): string | null {
  try {
    const version = browser.runtime.getManifest().version;
    return typeof version === "string" && version.length > 0 ? version : null;
  } catch {
    // A browser without getManifest cannot be checked; report failure quietly.
    return null;
  }
}

/** Pick the published version for this browser from the API response. */
function readPublishedVersion(
  body: unknown,
  target: StoreBrowser,
): string | null {
  if (typeof body !== "object" || body === null) return null;

  const extension = (body as Partial<VersionInfo>).extension;
  if (typeof extension !== "object" || extension === null) return null;

  const value = (extension as Record<string, unknown>)[target];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Read and compare the published version.
 *
 * Returns `null` for any failure; a successful check always returns a result,
 * including when no update is available.
 */
export async function checkForUpdate(
  fetchImpl: typeof fetch = fetch,
): Promise<VersionCheckResult | null> {
  const current = readInstalledVersion();
  if (current === null || parseVersion(current) === null) return null;

  let response: Response;
  try {
    // Native fetch rejects non-global receivers with "Illegal invocation".
    response = await fetchImpl.call(globalThis, `${API_BASE}/v1/version`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }

  const latest = readPublishedVersion(body, currentBrowser());
  if (latest === null) return null;

  const comparison = compareVersions(latest, current);
  if (comparison === null) return null;

  return { latest, current, updateAvailable: comparison > 0 };
}

/** Persisted update state; malformed or unreadable storage means no update. */
export async function readUpdateState(): Promise<UpdateState> {
  try {
    const stored = await browser.storage.local.get([
      UPDATE_AVAILABLE_STORAGE_KEY,
      LATEST_VERSION_STORAGE_KEY,
    ]);
    const latest = stored[LATEST_VERSION_STORAGE_KEY];
    return {
      updateAvailable: stored[UPDATE_AVAILABLE_STORAGE_KEY] === true,
      latestVersion:
        typeof latest === "string" && latest.trim().length > 0
          ? latest.trim()
          : null,
    };
  } catch {
    return { updateAvailable: false, latestVersion: null };
  }
}

/** True when the last successful check found a newer version. */
export async function isUpdateAvailable(): Promise<boolean> {
  return (await readUpdateState()).updateAvailable;
}

/**
 * Run the check and persist its result.
 *
 * Failures are logged and swallowed, and storage errors never surface either:
 * the update check must never crash the service worker. A successful check
 * that finds no update clears the stored flag.
 */
export async function runVersionCheck(
  fetchImpl: typeof fetch = fetch,
): Promise<VersionCheckResult | null> {
  const result = await checkForUpdate(fetchImpl);
  if (result === null) {
    console.error("[savetabs] update check failed");
    return null;
  }

  try {
    await browser.storage.local.set({
      [UPDATE_AVAILABLE_STORAGE_KEY]: result.updateAvailable,
      [LATEST_VERSION_STORAGE_KEY]: result.latest,
    });
  } catch (error) {
    console.error("[savetabs] failed to store the update state", error);
  }

  return result;
}

/**
 * Create the daily update alarm when it is missing.
 *
 * Called on install and startup. An existing alarm is left untouched so a
 * browser restart does not postpone the next check by a full day.
 */
export async function ensureVersionCheckAlarm(): Promise<void> {
  const existing = await browser.alarms.get(VERSION_CHECK_ALARM_NAME);
  if (existing !== undefined) return;

  await browser.alarms.create(VERSION_CHECK_ALARM_NAME, {
    periodInMinutes: VERSION_CHECK_PERIOD_MINUTES,
  });
}
