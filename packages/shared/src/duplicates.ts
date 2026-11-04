import type { SavedTab, Session } from "./types";

/** How URLs are compared when detecting duplicates. */
export type MatchMode = "exact" | "ignore-hash" | "ignore-query";

/** Returns true when the string parses as an absolute URL. */
function isAbsoluteUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes a URL for duplicate matching.
 *
 * - `exact` returns the URL unchanged.
 * - `ignore-hash` drops the `#...` fragment.
 * - `ignore-query` drops the `?...` query while keeping any trailing fragment.
 *
 * Everything else is preserved as-is: no trailing-slash rewriting, no host
 * casing changes, no percent-encoding round-trip. Malformed URLs (anything
 * `new URL` cannot parse) are returned unchanged so a saved tab is never lost;
 * dedupe then compares their raw strings.
 */
export function normalizeUrl(url: string, mode: MatchMode): string {
  if (mode === "exact") return url;
  if (!isAbsoluteUrl(url)) return url;

  const hashIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");

  if (mode === "ignore-hash") {
    return hashIndex === -1 ? url : url.slice(0, hashIndex);
  }

  // ignore-query: drop the query but keep a fragment that follows it.
  if (queryIndex === -1 || (hashIndex !== -1 && hashIndex < queryIndex)) {
    return url;
  }
  const queryEnd = hashIndex === -1 ? url.length : hashIndex;
  return url.slice(0, queryIndex) + url.slice(queryEnd);
}

/**
 * Removes duplicate tabs under the given match mode.
 * The first occurrence in tab order wins; the input array is not mutated.
 */
export function dedupeTabs(tabs: readonly SavedTab[], mode: MatchMode): SavedTab[] {
  const seen = new Set<string>();
  const result: SavedTab[] = [];
  for (const tab of tabs) {
    const key = normalizeUrl(tab.url, mode);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tab);
  }
  return result;
}

/**
 * Returns true when `url` matches any tab across all provided sessions,
 * using the same normalization as {@link dedupeTabs}.
 */
export function isUrlAlreadySaved(
  url: string,
  sessions: readonly Session[],
  mode: MatchMode,
): boolean {
  const target = normalizeUrl(url, mode);
  return sessions.some((session) =>
    session.tabs.some((tab) => normalizeUrl(tab.url, mode) === target),
  );
}
