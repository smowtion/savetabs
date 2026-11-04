/**
 * Pure tab collection for the save flow.
 *
 * `collectTabsForSave` decides which browser tabs can become `SavedTab`
 * entries. It performs no browser I/O and does not mutate its inputs, so the
 * same rules can be tested and reused by every save entrypoint.
 */

import {
  LIMITS,
  normalizeUrl,
  type MatchMode,
  type SavedTab,
  type Session,
  type Settings,
} from "@savetabs/shared";

/**
 * The subset of `browser.tabs.Tab` the collector needs.
 *
 * Only `url` is required in practice; browser tabs always carry an id, but
 * callers may pass plain objects (tests, imported selections) without one.
 */
export type TabLike = {
  /** Browser tab id, used by the save flow to close tabs after saving. */
  id?: number;
  url?: string;
  title?: string;
  /** May be a data: URI returned by the browser. */
  favIconUrl?: string;
  pinned?: boolean;
  audible?: boolean;
  incognito?: boolean;
  windowId?: number;
};

export type CollectTabsOptions = {
  settings: Settings;
  existingSessions: readonly Session[];
};

/** A saved tab together with the browser tab it came from. */
export type CollectedTab = {
  saved: SavedTab;
  source: TabLike;
};

export type CollectedTabEntries = {
  /** Tabs that fit under `LIMITS.maxTabsPerSession`, in tab order. */
  entries: CollectedTab[];
  /** Every input tab that was not included, overflow included. */
  skipped: number;
  /** Tabs that were eligible but pushed past the per-session cap. */
  overflow: number;
};

/**
 * Favicons are stored inline in the session blob, so oversized icons (usually
 * `data:` URIs) must be dropped before persisting. The spec caps them at 2 KB.
 */
const MAX_FAVICON_URL_LENGTH = 2 * 1024;

function readBoolean(settings: Settings, key: string): boolean {
  return settings[key] === true;
}

function readMatchMode(settings: Settings): MatchMode {
  const value = settings["duplicates.matchMode"];
  return value === "ignore-hash" || value === "ignore-query" ? value : "exact";
}

/**
 * Domain entries are user input: trim blanks, lowercase, drop leading and
 * trailing dots, and ignore empty strings. A bare domain matches both the
 * exact host and every subdomain of it.
 */
function readExcludedDomains(value: Settings[string]): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) =>
      entry
        .trim()
        .toLowerCase()
        .replace(/^\.+/, "")
        .replace(/\.+$/, ""),
    )
    .filter((entry) => entry.length > 0);
}

function isExcludedHost(url: string, domains: readonly string[]): boolean {
  if (domains.length === 0) return false;

  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname.length === 0) return false;

  return domains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

/**
 * Converts a browser tab into a `SavedTab`, or returns null when the tab
 * cannot be restored.
 *
 * Non-http(s) schemes are always dropped (`chrome://`, `edge://`, `about:`,
 * `chrome-extension://`, `devtools://`, `ftp://`, `data:`, ...). `file://`
 * survives only when the user enabled `tabs.includeFileUrls`.
 */
function toSavedTab(
  tab: TabLike,
  includeFileUrls: boolean,
): SavedTab | null {
  const url = tab.url;
  if (typeof url !== "string" || url.length === 0) return null;

  let protocol: string;
  try {
    protocol = new URL(url).protocol.toLowerCase();
  } catch {
    return null;
  }

  if (protocol !== "http:" && protocol !== "https:") {
    if (protocol !== "file:" || !includeFileUrls) return null;
  }

  const saved: SavedTab = {
    url,
    title:
      typeof tab.title === "string" && tab.title.length > 0
        ? tab.title
        : url,
  };
  if (
    typeof tab.favIconUrl === "string" &&
    tab.favIconUrl.length > 0 &&
    tab.favIconUrl.length < MAX_FAVICON_URL_LENGTH
  ) {
    saved.favIconUrl = tab.favIconUrl;
  }
  if (tab.pinned === true) saved.pinned = true;
  return saved;
}

/** Normalized URLs of every tab stored in the given sessions. */
function collectSavedUrls(
  sessions: readonly Session[],
  mode: MatchMode,
): Set<string> {
  const urls = new Set<string>();
  for (const session of sessions) {
    for (const tab of session.tabs) {
      urls.add(normalizeUrl(tab.url, mode));
    }
  }
  return urls;
}

/**
 * Filters, deduplicates and caps tabs for a save.
 *
 * The filter order is fixed: missing or unsupported URL, scheme, pinned,
 * audible, excluded domain, duplicates (`skipAlreadySaved` then in-batch
 * dedupe), and finally the 500-tab cap. Every excluded tab is counted once in
 * `skipped`, overflow included. This variant keeps the source tab so the save
 * flow can close exactly the tabs it saved; `collectTabsForSave` exposes the
 * plain public shape.
 */
export function collectTabEntries(
  tabs: readonly TabLike[],
  options: CollectTabsOptions,
): CollectedTabEntries {
  const { settings, existingSessions } = options;
  const includeFileUrls = readBoolean(settings, "tabs.includeFileUrls");
  const skipPinned = readBoolean(settings, "pinned.skipOnSave");
  const skipAudible = readBoolean(settings, "tabs.skipAudible");
  const excludedDomains = readExcludedDomains(
    settings["tabs.excludedDomains"],
  );
  const matchMode = readMatchMode(settings);
  const savedUrls = readBoolean(settings, "duplicates.skipAlreadySaved")
    ? collectSavedUrls(existingSessions, matchMode)
    : null;

  let skipped = 0;
  const candidates: CollectedTab[] = [];

  for (const tab of tabs) {
    const saved = toSavedTab(tab, includeFileUrls);
    if (saved === null) {
      skipped += 1;
      continue;
    }
    if (skipPinned && tab.pinned === true) {
      skipped += 1;
      continue;
    }
    if (skipAudible && tab.audible === true) {
      skipped += 1;
      continue;
    }
    if (isExcludedHost(saved.url, excludedDomains)) {
      skipped += 1;
      continue;
    }
    if (savedUrls !== null && savedUrls.has(normalizeUrl(saved.url, matchMode))) {
      skipped += 1;
      continue;
    }
    candidates.push({ saved, source: tab });
  }

  let deduplicated = candidates;
  if (readBoolean(settings, "duplicates.removeOnSave")) {
    const seen = new Set<string>();
    deduplicated = [];
    for (const candidate of candidates) {
      const key = normalizeUrl(candidate.saved.url, matchMode);
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      deduplicated.push(candidate);
    }
  }

  const entries = deduplicated.slice(0, LIMITS.maxTabsPerSession);
  const overflow = deduplicated.length - entries.length;

  return { entries, skipped: skipped + overflow, overflow };
}

/**
 * Collect the tabs that should be stored in a session.
 *
 * Pure: no browser APIs are touched and the input array is left unchanged.
 */
export function collectTabsForSave(
  tabs: readonly TabLike[],
  options: CollectTabsOptions,
): { tabs: SavedTab[]; skipped: number } {
  const { entries, skipped } = collectTabEntries(tabs, options);
  return { tabs: entries.map((entry) => entry.saved), skipped };
}
