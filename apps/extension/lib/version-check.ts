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

import { API_BASE, VERSION_MANIFEST_URL } from "./config";
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

type CheckOutcome = {
  result: VersionCheckResult | null;
  /** Populated when `result` is null so callers can log the real reason. */
  error?: unknown;
};

/**
 * Read and compare the published version, keeping the failure reason so the
 * background check can log it. Every failure resolves to a null result.
 */
async function checkForUpdateOutcome(
  fetchImpl: typeof fetch,
): Promise<CheckOutcome> {
  const current = readInstalledVersion();
  if (current === null || parseVersion(current) === null) {
    return {
      result: null,
      error: new Error(
        `the installed extension version "${current ?? "<missing>"}" is not comparable`,
      ),
    };
  }

  // Prefer the static Pages manifest, which does not spend Worker requests.
  // The Worker route remains a fallback during the first deployment that
  // introduces the static file.
  const candidates = [
    ...new Set([VERSION_MANIFEST_URL, `${API_BASE}/v1/version`]),
  ];

  let body: unknown = null;
  let lastError: unknown = null;
  for (const url of candidates) {
    try {
      // Native fetch rejects non-global receivers with "Illegal invocation".
      const response = await fetchImpl.call(globalThis, url, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        lastError = new Error(
          `the version endpoint returned HTTP ${response.status}`,
        );
        continue;
      }
      const candidate: unknown = await response.json();
      if (readPublishedVersion(candidate, currentBrowser()) === null) {
        lastError = new Error(
          "the version endpoint did not return a version for this browser",
        );
        continue;
      }
      body = candidate;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (body === null) {
    return {
      result: null,
      error: lastError ?? new Error("the version endpoint is unavailable"),
    };
  }

  const latest = readPublishedVersion(body, currentBrowser());
  if (latest === null) {
    return {
      result: null,
      error: new Error(
        "the version endpoint did not return a version for this browser",
      ),
    };
  }

  const comparison = compareVersions(latest, current);
  if (comparison === null) {
    return {
      result: null,
      error: new Error(`published version "${latest}" is not comparable`),
    };
  }

  return { result: { latest, current, updateAvailable: comparison > 0 } };
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
  return (await checkForUpdateOutcome(fetchImpl)).result;
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

/** Clear the stored "update available" flag; storage failures are non-fatal. */
async function clearUpdateAvailable(): Promise<void> {
  try {
    await browser.storage.local.set({
      [UPDATE_AVAILABLE_STORAGE_KEY]: false,
    });
  } catch (error) {
    console.error("[savetabs] failed to clear the update state", error);
  }
}

/**
 * Drop an "update available" flag that the running version already satisfies.
 *
 * Called on install, update and startup. Without this, a self-update can leave
 * the toolbar `↑` badge and the banner visible until the next daily check.
 * Returns true when the flag was cleared so the caller can repaint the badge.
 * A flag for a genuinely newer published version is left untouched.
 */
export async function reconcileUpdateState(): Promise<boolean> {
  const state = await readUpdateState();
  if (!state.updateAvailable) return false;

  const current = readInstalledVersion();
  const latest = state.latestVersion;
  if (current === null || latest === null) {
    // Without both versions the flag cannot be verified; drop it rather than
    // keep a badge that may be stale.
    await clearUpdateAvailable();
    return true;
  }

  const comparison = compareVersions(latest, current);
  if (comparison !== null && comparison > 0) return false;

  await clearUpdateAvailable();
  return true;
}

/**
 * Run the check and persist its result.
 *
 * Failures are logged with their underlying cause and swallowed, and storage
 * errors never surface either: the update check must never crash the service
 * worker. A successful check that finds no update clears the stored flag.
 */
export async function runVersionCheck(
  fetchImpl: typeof fetch = fetch,
): Promise<VersionCheckResult | null> {
  const outcome = await checkForUpdateOutcome(fetchImpl);
  const result = outcome.result;
  if (result === null) {
    console.error("[savetabs] update check failed", outcome.error);
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
