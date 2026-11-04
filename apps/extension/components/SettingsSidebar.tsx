/**
 * Options sidebar: logo, all schema categories with live setting counts and
 * the active category. The 220px column collapses into a `<select>` below
 * 900px so the page stays usable on narrow windows.
 */

import {
  SETTINGS_SCHEMA,
  type CategoryId,
  type Translator,
} from "@savetabs/shared";

export type SettingsSidebarProps = {
  activeCategory: CategoryId;
  onSelect: (category: CategoryId) => void;
  t: Translator;
};

/** Counts are derived from the schema so they cannot drift from the settings. */
const CATEGORIES = SETTINGS_SCHEMA.map((category) => ({
  id: category.id,
  labelKey: category.labelKey,
  count: category.settings.length,
}));

export function SettingsSidebar({
  activeCategory,
  onSelect,
  t,
}: SettingsSidebarProps) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 border-b border-neutral-200 bg-white px-3 py-4 dark:border-neutral-800 dark:bg-neutral-950 min-[900px]:sticky min-[900px]:top-0 min-[900px]:h-screen min-[900px]:w-[220px] min-[900px]:border-b-0 min-[900px]:border-r">
      <div className="px-2 text-lg font-semibold tracking-tight">SaveTabs</div>

      <select
        aria-label={t("options.categories")}
        value={activeCategory}
        onChange={(event) => onSelect(event.target.value as CategoryId)}
        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 min-[900px]:hidden"
      >
        {CATEGORIES.map((category) => (
          <option key={category.id} value={category.id}>
            {`${t(category.labelKey)} (${t("options.settingCount", {
              count: category.count,
            })})`}
          </option>
        ))}
      </select>

      <nav
        aria-label={t("options.categories")}
        className="hidden min-[900px]:block"
      >
        <ul className="flex flex-col gap-1">
          {CATEGORIES.map((category) => {
            const active = category.id === activeCategory;
            return (
              <li key={category.id}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onSelect(category.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    active
                      ? "bg-neutral-900 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  }`}
                >
                  <span>{t(category.labelKey)}</span>
                  <span
                    className={`rounded-full px-1.5 text-xs tabular-nums ${
                      active
                        ? "bg-white/20"
                        : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                    }`}
                  >
                    {category.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
