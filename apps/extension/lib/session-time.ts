/**
 * Localized timestamps for the sessions page.
 *
 * Recent sessions show a relative label from the i18n dictionary ("5 minutes
 * ago"); sessions older than a week fall back to an absolute date formatted
 * with `Intl.DateTimeFormat`. The absolute form is always returned too so the
 * card can expose it as a tooltip without a second format call.
 */

import type { Lang, Translator } from "@savetabs/shared";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Sessions at least this old render an absolute date instead of a relative one. */
const RELATIVE_LIMIT_MS = 7 * DAY_MS;

export type SessionTime = {
  /** Short human label for the card ("Just now", "2 hours ago", or a date). */
  relative: string;
  /** Full localized date and time used for the `title` tooltip. */
  absolute: string;
};

/** Format one session timestamp for display at `now`. */
export function formatSessionTime(
  timestamp: number,
  now: number,
  lang: Lang,
  t: Translator,
): SessionTime {
  const absolute = new Intl.DateTimeFormat(lang, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));

  // Clock skew or a future timestamp must not produce a negative label.
  const elapsed = Math.max(0, now - timestamp);
  let relative: string;

  if (elapsed < MINUTE_MS) {
    relative = t("sessions.time.justNow");
  } else if (elapsed < HOUR_MS) {
    relative = t("sessions.time.minutesAgo", {
      count: Math.floor(elapsed / MINUTE_MS),
    });
  } else if (elapsed < DAY_MS) {
    relative = t("sessions.time.hoursAgo", {
      count: Math.floor(elapsed / HOUR_MS),
    });
  } else if (elapsed < RELATIVE_LIMIT_MS) {
    relative = t("sessions.time.daysAgo", {
      count: Math.floor(elapsed / DAY_MS),
    });
  } else {
    relative = absolute;
  }

  return { relative, absolute };
}
