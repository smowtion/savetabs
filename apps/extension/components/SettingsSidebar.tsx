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
import {
  Clipboard,
  Cloud,
  Copy,
  EyeOff,
  Gauge,
  History,
  Keyboard,
  Layers,
  Link as LinkIcon,
  MousePointerClick,
  PanelTopOpen,
  Pin,
  RotateCcw,
  Settings,
  Wrench,
} from "lucide-react";
import { browser } from "wxt/browser";

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

const CATEGORY_ICONS = {
  general: Settings,
  tabs: Layers,
  duplicates: Copy,
  pinned: Pin,
  open: PanelTopOpen,
  urlDisplay: LinkIcon,
  restore: RotateCcw,
  clipboard: Clipboard,
  contextMenu: MousePointerClick,
  memory: Gauge,
  shortcuts: Keyboard,
  incognito: EyeOff,
  sync: Cloud,
  advanced: Wrench,
} as const;

const CHANGELOG_URL = "https://savetabs.azcom.dev/changelog";

export function SettingsSidebar({
  activeCategory,
  onSelect,
  t,
}: SettingsSidebarProps) {
  let version = "";
  try {
    version = browser.runtime.getManifest().version ?? "";
  } catch {
    // The fake browser used by unit tests does not implement getManifest.
  }

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 border-b border-neutral-200 bg-white px-3 py-4 dark:border-neutral-800 dark:bg-neutral-950 min-[900px]:sticky min-[900px]:top-0 min-[900px]:h-screen min-[900px]:w-[220px] min-[900px]:border-b-0 min-[900px]:border-e">
      <div className="flex items-center gap-2 px-2">
        <img
          src="/icon/icon-32.png"
          alt=""
          width={28}
          height={28}
          className="size-7 rounded-lg"
        />
        <span className="text-lg font-semibold tracking-tight">SaveTabs</span>
      </div>

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
            const Icon = CATEGORY_ICONS[category.id];
            return (
              <li key={category.id}>
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onSelect(category.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors ${
                    active
                      ? "bg-neutral-900 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  }`}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {t(category.labelKey)}
                  </span>
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

      <div className="mt-auto flex flex-col gap-1 border-t border-neutral-200 px-2 pt-3 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {version !== "" && <span className="tabular-nums">v{version}</span>}
        <a
          href={CHANGELOG_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 font-medium text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
        >
          <History aria-hidden="true" className="size-3.5" />
          {t("options.changelog")}
        </a>
      </div>
    </aside>
  );
}
