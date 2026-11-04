/** The tab state needed to decide whether the tab may be discarded. */
export type DiscardCandidate = {
  id: number;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  /** True when the browser has already unloaded the tab. */
  discarded: boolean;
  /** Missing when the browser withholds the URL (for example restricted pages). */
  url?: string;
  /** epoch ms of the last time the tab was active. */
  lastActiveAt: number;
};

/** Settings that shape the discard policy for one scan. */
export type DiscardOptions = {
  /** epoch ms */
  now: number;
  timeoutMinutes: number;
  keepPinned: boolean;
  keepAudible: boolean;
  /** Hostnames whose tabs are never discarded; subdomains are included. */
  excludedDomains: readonly string[];
};

/**
 * Returns true when `url` belongs to an excluded host.
 * A missing or malformed URL never matches, so an unknown tab is not protected.
 */
function isExcludedUrl(url: string | undefined, excludedDomains: readonly string[]): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return excludedDomains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/**
 * Decides whether one tab may be discarded to free memory.
 *
 * A tab is eligible only when it is not active, is not discarded already, is
 * not protected by the pinned/audible switches, is not on an excluded host,
 * and has been inactive for at least `timeoutMinutes`.
 */
export function isDiscardEligible(
  tab: DiscardCandidate,
  opts: DiscardOptions,
): boolean {
  if (tab.active) return false;
  if (opts.keepPinned && tab.pinned) return false;
  if (opts.keepAudible && tab.audible) return false;
  if (tab.discarded) return false;
  if (isExcludedUrl(tab.url, opts.excludedDomains)) return false;
  return opts.now - tab.lastActiveAt >= opts.timeoutMinutes * 60_000;
}
