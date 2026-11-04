/**
 * Pure settings search used by the options page.
 *
 * Matching is instant (no debounce) and considers, for every setting:
 * - the translated category label,
 * - the translated setting label and description,
 * - the hidden English keywords from the schema,
 * - the dotted setting key.
 *
 * An empty query returns every category, including the categories that hold
 * no settings (shortcuts and advanced), so callers can render the normal
 * accordion list without special-casing them.
 */

import {
  SETTINGS_SCHEMA,
  createTranslator,
  type CategoryId,
  type Lang,
  type SettingDef,
} from "@savetabs/shared";

/** Settings matching a query, grouped under their category. */
export type SettingsSearchGroup = {
  category: CategoryId;
  settings: SettingDef[];
};

/** Normalize user input once; search is case-insensitive and trimmed. */
function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Return the categories and settings that match `query` in `lang`.
 * Categories without a matching setting are omitted. An empty or
 * whitespace-only query returns the full schema.
 */
export function filterSettings(
  query: string,
  lang: Lang,
): SettingsSearchGroup[] {
  const normalized = normalizeQuery(query);

  if (normalized === "") {
    return SETTINGS_SCHEMA.map((category) => ({
      category: category.id,
      settings: [...category.settings],
    }));
  }

  const t = createTranslator(lang);
  const groups: SettingsSearchGroup[] = [];

  for (const category of SETTINGS_SCHEMA) {
    const categoryLabel = t(category.labelKey);
    const matches = category.settings.filter((setting) => {
      const searchable = [
        categoryLabel,
        t(setting.labelKey),
        t(setting.descriptionKey),
        ...(setting.keywords ?? []),
        setting.key,
      ]
        .join("\n")
        .toLowerCase();
      return searchable.includes(normalized);
    });

    if (matches.length > 0) {
      groups.push({ category: category.id, settings: matches });
    }
  }

  return groups;
}
