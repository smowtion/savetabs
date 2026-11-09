/**
 * Relative timestamp label for the most recent completed full sync.
 *
 * Shared by the options status panel and the toolbar popup so both surfaces
 * describe "last sync" the same way in every locale.
 */

import type { Translator } from "@savetabs/shared";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Relative label for `syncLastAt`, reusing the sessions-page time strings. */
export function formatLastSync(
  timestamp: number,
  now: number,
  t: Translator,
): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE_MS) return t("sessions.time.justNow");
  if (elapsed < HOUR_MS) {
    return t("sessions.time.minutesAgo", {
      count: Math.floor(elapsed / MINUTE_MS),
    });
  }
  if (elapsed < DAY_MS) {
    return t("sessions.time.hoursAgo", {
      count: Math.floor(elapsed / HOUR_MS),
    });
  }
  return t("sessions.time.daysAgo", { count: Math.floor(elapsed / DAY_MS) });
}
