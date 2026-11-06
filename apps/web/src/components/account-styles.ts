/**
 * Shared Tailwind classes for the account page and its sections.
 *
 * The forms are split across small components; keeping the field, label and
 * button styles here prevents the same long class strings from drifting.
 */

export const ACCOUNT_SECTION_CLASS =
  "rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900";
export const ACCOUNT_FIELD_CLASS =
  "mt-2 block w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
export const ACCOUNT_LABEL_CLASS =
  "block text-sm font-medium text-neutral-800 dark:text-neutral-200";
export const ACCOUNT_PRIMARY_BUTTON_CLASS =
  "w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50";
export const ACCOUNT_DANGER_BUTTON_CLASS =
  "w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-50";
export const ACCOUNT_ALERT_CLASS =
  "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300";
export const ACCOUNT_LINK_CLASS =
  "text-indigo-700 underline-offset-4 hover:underline dark:text-indigo-400";
