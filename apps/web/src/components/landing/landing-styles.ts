/**
 * Shared Tailwind classes for the landing page sections.
 *
 * The page is composed from small section components; keeping the container,
 * card and action styles here prevents the same long class strings from
 * drifting between them. Focus treatments match the rest of the web app.
 */

export const SECTION_CLASS =
  "border-t border-neutral-200 dark:border-neutral-800";

export const SECTION_INNER_CLASS =
  "motion-fade-up mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20";

export const SECTION_TITLE_CLASS =
  "text-balance text-2xl font-bold tracking-tight sm:text-3xl";

export const SECTION_LEAD_CLASS =
  "mt-3 max-w-2xl text-pretty text-base text-neutral-600 dark:text-neutral-400";

export const CARD_CLASS =
  "motion-hover-lift rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";

export const MUTED_TEXT_CLASS =
  "text-sm leading-6 text-neutral-600 dark:text-neutral-400";

export const PRIMARY_LINK_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500";

export const SECONDARY_LINK_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-5 py-3 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800";

export const DISABLED_BUTTON_CLASS =
  "inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-5 py-3 text-sm font-semibold text-neutral-800 opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

export const TEXT_LINK_CLASS =
  "font-medium text-indigo-600 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-400";

/** Header controls reuse the compact bordered style from the old landing page. */
export const HEADER_CONTROL_CLASS =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800";
