/**
 * Persistence for the options accordion state.
 *
 * The set of open sections lives in `chrome.storage.local` under
 * `ui.openSections`. Values come from user-controlled storage, so they are
 * sanitized before use: unknown category ids, duplicates and non-strings are
 * dropped and a failed read falls back to a fully collapsed page.
 */

import { SETTINGS_SCHEMA, type CategoryId } from "@savetabs/shared";
import { browser } from "wxt/browser";

/** Storage key holding the ids of the expanded accordion sections. */
export const OPEN_SECTIONS_STORAGE_KEY = "ui.openSections";

const CATEGORY_IDS: ReadonlySet<string> = new Set(
  SETTINGS_SCHEMA.map((category) => category.id),
);

/**
 * Keep only known category ids, in their original order and without
 * duplicates. Anything that is not an array of strings yields an empty list.
 */
export function sanitizeOpenSections(raw: unknown): CategoryId[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const sections: CategoryId[] = [];

  for (const value of raw) {
    if (
      typeof value !== "string" ||
      !CATEGORY_IDS.has(value) ||
      seen.has(value)
    ) {
      continue;
    }
    seen.add(value);
    sections.push(value as CategoryId);
  }

  return sections;
}

/** Load the expanded section ids, tolerating empty or unreadable storage. */
export async function loadOpenSections(): Promise<CategoryId[]> {
  try {
    const stored = await browser.storage.local.get(OPEN_SECTIONS_STORAGE_KEY);
    return sanitizeOpenSections(stored[OPEN_SECTIONS_STORAGE_KEY]);
  } catch {
    return [];
  }
}

/** Persist the expanded section ids in the schema-validated form. */
export async function saveOpenSections(
  sections: readonly CategoryId[],
): Promise<void> {
  await browser.storage.local.set({
    [OPEN_SECTIONS_STORAGE_KEY]: sanitizeOpenSections(sections),
  });
}
