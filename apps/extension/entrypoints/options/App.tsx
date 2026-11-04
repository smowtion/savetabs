/**
 * Options page shell.
 *
 * Layout A: a fixed 220px category sidebar on desktop (a select below 900px)
 * and an accordion list of every schema category. Search filters the
 * accordions instantly through the pure search helper, Expand all / Collapse
 * all persist their state in `storage.local`, and the theme button cycles the
 * stored `general.theme` preference.
 *
 * Setting controls are rendered inside each accordion by the category section;
 * this shell owns navigation, filtering and chrome around them.
 */

import { SETTINGS_SCHEMA, type CategoryId } from "@savetabs/shared";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Accordion } from "../../components/Accordion";
import { CategorySection } from "../../components/CategorySection";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SearchBar } from "../../components/SearchBar";
import { SettingsSidebar } from "../../components/SettingsSidebar";
import { SyncSection } from "../../components/SyncSection";
import { UpdateBanner } from "../../components/UpdateBanner";
import { useI18n } from "../../hooks/useI18n";
import { useOpenSections } from "../../hooks/useOpenSections";
import { useSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { isDiscardSupported } from "../../lib/discard";
import {
  filterSettings,
  type SettingsSearchGroup,
} from "../../lib/search-settings";
import type { SettingValue } from "../../lib/settings";
import { syncNow } from "../../lib/sync/sync-service";
import { nextThemePreference, normalizeThemePreference } from "../../lib/theme";

const ALL_SETTINGS_GROUPS: readonly SettingsSearchGroup[] = SETTINGS_SCHEMA.map(
  (category) => ({
    category: category.id,
    settings: [...category.settings],
  }),
);

const CATEGORIES_BY_ID = new Map(
  SETTINGS_SCHEMA.map((category) => [category.id, category] as const),
);

function sectionElementId(category: CategoryId): string {
  return `settings-section-${category}`;
}

export function App() {
  const { settings, saved, updateSetting } = useSettings();
  const { lang, t } = useI18n(settings?.["general.language"]);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryId>("general");
  // Enabling sync is gated on the user confirming they saved the only key
  // that can ever decrypt their cloud data.
  const [syncEnableConfirmOpen, setSyncEnableConfirmOpen] = useState(false);
  const { openSections, setSectionOpen, expandAll, collapseAll } =
    useOpenSections();

  const themePreference = normalizeThemePreference(settings?.["general.theme"]);
  useTheme(themePreference);

  // Browsers without `tabs.discard` cannot use the memory features; the rows
  // then render disabled with an explanation instead of offering dead controls.
  const discardSupported = isDiscardSupported();

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `SaveTabs — ${t("common.settings")}`;
  }, [lang, t]);

  const isSearching = query.trim().length > 0;
  const groups: readonly SettingsSearchGroup[] = useMemo(
    () => (isSearching ? filterSettings(query, lang) : ALL_SETTINGS_GROUPS),
    [isSearching, query, lang],
  );

  function selectCategory(category: CategoryId): void {
    setActiveCategory(category);
    setQuery("");
    setSectionOpen(category, true);
    document
      .getElementById(sectionElementId(category))
      ?.scrollIntoView?.({ block: "start" });
  }

  function cycleTheme(): void {
    void updateSetting(
      "general.theme",
      nextThemePreference(themePreference),
    ).catch((error) => {
      console.error("[savetabs] failed to save theme", error);
    });
  }

  /**
   * Turning sync on (false -> true) never writes directly: it opens the
   * key-saved confirmation first. Everything else proceeds untouched.
   */
  function beforeSettingChange(
    key: string,
    next: SettingValue,
    current: SettingValue | undefined,
  ): boolean {
    if (key === "sync.enabled" && next === true && current !== true) {
      setSyncEnableConfirmOpen(true);
      return false;
    }
    return true;
  }

  function confirmSyncEnable(): void {
    setSyncEnableConfirmOpen(false);
    void updateSetting("sync.enabled", true)
      .then(() => {
        // Turning sync on is a user decision to reconcile now; failures are
        // shown by the status panel's next manual run.
        void syncNow().catch((error) => {
          console.error("[savetabs] sync after enabling failed", error);
        });
      })
      .catch((error) => {
        console.error("[savetabs] failed to enable sync", error);
      });
  }

  const ThemeIcon =
    themePreference === "light"
      ? Sun
      : themePreference === "dark"
        ? Moon
        : Monitor;
  const themeLabel = t("options.theme.toggle", {
    theme: t(`options.theme.${themePreference}`),
  });

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 min-[900px]:flex-row">
      <SettingsSidebar
        activeCategory={activeCategory}
        onSelect={selectCategory}
        t={t}
      />

      <main className="min-w-0 flex-1 px-4 py-6 min-[900px]:px-8">
        <header className="mb-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">{t("common.settings")}</h1>
            {saved && (
              <span
                role="status"
                className="text-sm font-medium text-green-600 dark:text-green-400"
              >
                {t("options.saved")}
              </span>
            )}
            <button
              type="button"
              onClick={cycleTheme}
              aria-label={themeLabel}
              title={themeLabel}
              className="ml-auto rounded-md border border-neutral-300 bg-white p-2 text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <ThemeIcon aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SearchBar
              value={query}
              onChange={setQuery}
              label={t("options.search")}
              placeholder={t("options.searchPlaceholder")}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={expandAll}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {t("options.expandAll")}
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {t("options.collapseAll")}
              </button>
            </div>
          </div>
        </header>

        <UpdateBanner t={t} className="mb-4" />

        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            {t("options.noResults")}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((group) => {
              const category = CATEGORIES_BY_ID.get(group.category);
              if (!category) return null;

              return (
                <Accordion
                  key={group.category}
                  categoryId={group.category}
                  title={t(category.labelKey)}
                  description={t(`settings.${category.id}.description`)}
                  count={group.settings.length}
                  open={isSearching || openSections.has(group.category)}
                  onToggle={(next) => setSectionOpen(group.category, next)}
                >
                  {group.category === "sync" && (
                    <SyncSection
                      t={t}
                      syncEnabled={settings?.["sync.enabled"] === true}
                    />
                  )}
                  <CategorySection
                    categoryId={group.category}
                    settings={group.settings}
                    values={settings}
                    t={t}
                    onChange={updateSetting}
                    beforeChange={beforeSettingChange}
                    discardSupported={discardSupported}
                  />
                </Accordion>
              );
            })}
          </div>
        )}
      </main>

      {syncEnableConfirmOpen && (
        <ConfirmDialog
          title={t("settings.sync.enableConfirmTitle")}
          message={t("settings.sync.enableConfirmMessage")}
          confirmLabel={t("settings.sync.enableConfirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={confirmSyncEnable}
          onCancel={() => setSyncEnableConfirmOpen(false)}
        />
      )}
    </div>
  );
}
