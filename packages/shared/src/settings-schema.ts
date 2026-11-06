/**
 * Typed settings schema shared by the options UI, the settings store and
 * settings import/export.
 *
 * The schema is the single source of truth for the category order, the i18n
 * label/description keys, default values and runtime validation. Every setting
 * listed here must be read by real behavior somewhere in the extension; the
 * coverage test in the extension package enforces that.
 */

import { LANGS } from "./i18n/locales";
import type { Settings } from "./types";

/** Categories shown in the options sidebar, in display order. */
export type CategoryId =
  | "general"
  | "tabs"
  | "duplicates"
  | "pinned"
  | "open"
  | "urlDisplay"
  | "restore"
  | "clipboard"
  | "contextMenu"
  | "memory"
  | "shortcuts"
  | "incognito"
  | "sync"
  | "advanced";

type SettingMetadata = {
  /** Dotted key stored in chrome.storage.local, e.g. "tabs.closeAfterSave". */
  key: string;
  /** i18n key for the setting label. */
  labelKey: string;
  /** i18n key for the setting description. */
  descriptionKey: string;
  /** Extra search terms used by the options search box. */
  keywords?: readonly string[];
};

/**
 * One setting definition. Enum values accept numbers as well as strings
 * because `memory.timeoutMinutes` is a numeric enum (5/15/30/60/120).
 */
export type SettingDef = SettingMetadata &
  (
    | { type: "boolean"; default: boolean; minVersion?: number }
    | { type: "enum"; values: readonly (string | number)[]; default: string | number }
    | { type: "number"; default: number; min: number; max: number; step?: number }
    | { type: "string-list"; default: string[]; maxItems: number }
  );

export type SettingsCategory = {
  id: CategoryId;
  labelKey: string;
  settings: readonly SettingDef[];
};

export const SETTINGS_SCHEMA: readonly SettingsCategory[] = [
  {
    id: "general",
    labelKey: "settings.general.label",
    settings: [
      {
        key: "general.theme",
        type: "enum",
        values: ["system", "light", "dark"],
        default: "system",
        labelKey: "settings.general.theme.label",
        descriptionKey: "settings.general.theme.description",
        keywords: ["theme", "appearance", "dark", "light", "color"],
      },
      {
        key: "general.language",
        type: "enum",
        values: ["auto", ...LANGS],
        default: "auto",
        labelKey: "settings.general.language.label",
        descriptionKey: "settings.general.language.description",
        keywords: ["language", "locale", "english", "vietnamese", "chinese", "spanish", "hindi", "arabic", "i18n"],
      },
      {
        key: "general.showBadgeCount",
        type: "boolean",
        default: true,
        labelKey: "settings.general.showBadgeCount.label",
        descriptionKey: "settings.general.showBadgeCount.description",
        keywords: ["badge", "count", "icon", "toolbar"],
      },
      {
        key: "general.confirmThreshold",
        type: "number",
        default: 20,
        min: 0,
        max: 500,
        step: 1,
        labelKey: "settings.general.confirmThreshold.label",
        descriptionKey: "settings.general.confirmThreshold.description",
        keywords: ["confirm", "threshold", "dialog", "close", "warning"],
      },
    ],
  },
  {
    id: "tabs",
    labelKey: "settings.tabs.label",
    settings: [
      {
        key: "tabs.saveAllWindows",
        type: "boolean",
        default: false,
        labelKey: "settings.tabs.saveAllWindows.label",
        descriptionKey: "settings.tabs.saveAllWindows.description",
        keywords: ["windows", "all windows", "save"],
      },
      {
        key: "tabs.closeAfterSave",
        type: "boolean",
        default: true,
        labelKey: "settings.tabs.closeAfterSave.label",
        descriptionKey: "settings.tabs.closeAfterSave.description",
        keywords: ["close", "after save", "tabs"],
      },
      {
        key: "tabs.skipAudible",
        type: "boolean",
        default: false,
        labelKey: "settings.tabs.skipAudible.label",
        descriptionKey: "settings.tabs.skipAudible.description",
        keywords: ["audible", "audio", "sound", "playing", "media"],
      },
      {
        key: "tabs.excludedDomains",
        type: "string-list",
        default: [],
        maxItems: 200,
        labelKey: "settings.tabs.excludedDomains.label",
        descriptionKey: "settings.tabs.excludedDomains.description",
        keywords: ["excluded", "domains", "blocklist", "never save", "ignore"],
      },
      {
        key: "tabs.includeFileUrls",
        type: "boolean",
        default: false,
        labelKey: "settings.tabs.includeFileUrls.label",
        descriptionKey: "settings.tabs.includeFileUrls.description",
        keywords: ["file", "file url", "local", "permissions"],
      },
    ],
  },
  {
    id: "duplicates",
    labelKey: "settings.duplicates.label",
    settings: [
      {
        key: "duplicates.removeOnSave",
        type: "boolean",
        default: true,
        labelKey: "settings.duplicates.removeOnSave.label",
        descriptionKey: "settings.duplicates.removeOnSave.description",
        keywords: ["duplicates", "dedupe", "remove", "urls"],
      },
      {
        key: "duplicates.matchMode",
        type: "enum",
        values: ["exact", "ignore-hash", "ignore-query"],
        default: "exact",
        labelKey: "settings.duplicates.matchMode.label",
        descriptionKey: "settings.duplicates.matchMode.description",
        keywords: ["duplicates", "match", "url", "hash", "query"],
      },
      {
        key: "duplicates.skipAlreadySaved",
        type: "boolean",
        default: false,
        labelKey: "settings.duplicates.skipAlreadySaved.label",
        descriptionKey: "settings.duplicates.skipAlreadySaved.description",
        keywords: ["duplicates", "already saved", "skip", "existing"],
      },
    ],
  },
  {
    id: "pinned",
    labelKey: "settings.pinned.label",
    settings: [
      {
        key: "pinned.skipOnSave",
        type: "boolean",
        default: true,
        labelKey: "settings.pinned.skipOnSave.label",
        descriptionKey: "settings.pinned.skipOnSave.description",
        keywords: ["pinned", "skip", "save"],
      },
      {
        key: "pinned.restoreAsPinned",
        type: "boolean",
        default: true,
        labelKey: "settings.pinned.restoreAsPinned.label",
        descriptionKey: "settings.pinned.restoreAsPinned.description",
        keywords: ["pinned", "restore", "pin"],
      },
    ],
  },
  {
    id: "open",
    labelKey: "settings.open.label",
    settings: [
      {
        key: "open.toolbarAction",
        type: "enum",
        values: ["popup", "save", "sessions"],
        default: "popup",
        labelKey: "settings.open.toolbarAction.label",
        descriptionKey: "settings.open.toolbarAction.description",
        keywords: ["toolbar", "icon", "click", "popup", "action"],
      },
      {
        key: "open.openSessionsAfterSave",
        type: "boolean",
        default: true,
        labelKey: "settings.open.openSessionsAfterSave.label",
        descriptionKey: "settings.open.openSessionsAfterSave.description",
        keywords: ["sessions", "open", "after save", "page"],
      },
      {
        key: "open.reuseSessionsTab",
        type: "boolean",
        default: true,
        labelKey: "settings.open.reuseSessionsTab.label",
        descriptionKey: "settings.open.reuseSessionsTab.description",
        keywords: ["reuse", "sessions", "tab", "existing"],
      },
    ],
  },
  {
    id: "urlDisplay",
    labelKey: "settings.urlDisplay.label",
    settings: [
      {
        key: "urlDisplay.mode",
        type: "enum",
        values: ["title", "domain", "full-url"],
        default: "title",
        labelKey: "settings.urlDisplay.mode.label",
        descriptionKey: "settings.urlDisplay.mode.description",
        keywords: ["display", "url", "title", "domain", "full url"],
      },
      {
        key: "urlDisplay.showFavicons",
        type: "boolean",
        default: true,
        labelKey: "settings.urlDisplay.showFavicons.label",
        descriptionKey: "settings.urlDisplay.showFavicons.description",
        keywords: ["favicon", "icons", "display"],
      },
      {
        key: "urlDisplay.showTabCount",
        type: "boolean",
        default: true,
        labelKey: "settings.urlDisplay.showTabCount.label",
        descriptionKey: "settings.urlDisplay.showTabCount.description",
        keywords: ["tab count", "badge", "header", "count"],
      },
    ],
  },
  {
    id: "restore",
    labelKey: "settings.restore.label",
    settings: [
      {
        key: "restore.targetWindow",
        type: "enum",
        values: ["current", "new"],
        default: "current",
        labelKey: "settings.restore.targetWindow.label",
        descriptionKey: "settings.restore.targetWindow.description",
        keywords: ["restore", "window", "current", "new"],
      },
      {
        key: "restore.openInBackground",
        type: "boolean",
        default: true,
        labelKey: "settings.restore.openInBackground.label",
        descriptionKey: "settings.restore.openInBackground.description",
        keywords: ["restore", "background", "focus", "tabs"],
      },
      {
        key: "restore.skipExisting",
        type: "boolean",
        default: false,
        labelKey: "settings.restore.skipExisting.label",
        descriptionKey: "settings.restore.skipExisting.description",
        keywords: ["restore", "skip", "existing", "open", "duplicate"],
      },
    ],
  },
  {
    id: "clipboard",
    labelKey: "settings.clipboard.label",
    settings: [
      {
        key: "clipboard.format",
        type: "enum",
        values: ["plain-urls", "markdown", "titled"],
        default: "plain-urls",
        labelKey: "settings.clipboard.format.label",
        descriptionKey: "settings.clipboard.format.description",
        keywords: ["clipboard", "copy", "format", "markdown", "titles"],
      },
    ],
  },
  {
    id: "contextMenu",
    labelKey: "settings.contextMenu.label",
    settings: [
      {
        key: "contextMenu.enabled",
        type: "boolean",
        default: true,
        labelKey: "settings.contextMenu.enabled.label",
        descriptionKey: "settings.contextMenu.enabled.description",
        keywords: ["context menu", "menu", "right click", "enable"],
      },
      {
        key: "contextMenu.saveTab",
        type: "boolean",
        default: true,
        labelKey: "settings.contextMenu.saveTab.label",
        descriptionKey: "settings.contextMenu.saveTab.description",
        keywords: ["context menu", "save tab", "menu item"],
      },
      {
        key: "contextMenu.saveWindow",
        type: "boolean",
        default: true,
        labelKey: "settings.contextMenu.saveWindow.label",
        descriptionKey: "settings.contextMenu.saveWindow.description",
        keywords: ["context menu", "save window", "menu item"],
      },
      {
        key: "contextMenu.saveSelection",
        type: "boolean",
        default: true,
        labelKey: "settings.contextMenu.saveSelection.label",
        descriptionKey: "settings.contextMenu.saveSelection.description",
        keywords: ["context menu", "save selection", "menu item"],
      },
    ],
  },
  {
    id: "memory",
    labelKey: "settings.memory.label",
    settings: [
      {
        key: "memory.autoDiscard",
        type: "boolean",
        default: true,
        labelKey: "settings.memory.autoDiscard.label",
        descriptionKey: "settings.memory.autoDiscard.description",
        keywords: ["discard", "memory", "auto discard", "ram", "unload"],
      },
      {
        key: "memory.timeoutMinutes",
        type: "enum",
        values: [5, 15, 30, 60, 120],
        default: 30,
        labelKey: "settings.memory.timeoutMinutes.label",
        descriptionKey: "settings.memory.timeoutMinutes.description",
        keywords: ["discard", "timeout", "minutes", "idle", "inactive"],
      },
      {
        key: "memory.keepAudible",
        type: "boolean",
        default: true,
        labelKey: "settings.memory.keepAudible.label",
        descriptionKey: "settings.memory.keepAudible.description",
        keywords: ["discard", "audible", "audio", "keep", "playing"],
      },
      {
        key: "memory.keepPinned",
        type: "boolean",
        default: true,
        labelKey: "settings.memory.keepPinned.label",
        descriptionKey: "settings.memory.keepPinned.description",
        keywords: ["discard", "pinned", "keep"],
      },
    ],
  },
  {
    id: "shortcuts",
    labelKey: "settings.shortcuts.label",
    settings: [],
  },
  {
    id: "incognito",
    labelKey: "settings.incognito.label",
    settings: [
      {
        key: "incognito.includeInSaveAll",
        type: "boolean",
        default: false,
        labelKey: "settings.incognito.includeInSaveAll.label",
        descriptionKey: "settings.incognito.includeInSaveAll.description",
        keywords: ["incognito", "private", "save all", "windows"],
      },
    ],
  },
  {
    id: "sync",
    labelKey: "settings.sync.label",
    settings: [
      {
        key: "sync.enabled",
        type: "boolean",
        default: false,
        labelKey: "settings.sync.enabled.label",
        descriptionKey: "settings.sync.enabled.description",
        keywords: ["sync", "e2ee", "encryption", "cloud", "enable"],
      },
      {
        key: "sync.autoUpload",
        type: "boolean",
        default: true,
        labelKey: "settings.sync.autoUpload.label",
        descriptionKey: "settings.sync.autoUpload.description",
        keywords: ["sync", "upload", "auto", "backup"],
      },
      {
        key: "sync.autoDownload",
        type: "boolean",
        default: true,
        labelKey: "settings.sync.autoDownload.label",
        descriptionKey: "settings.sync.autoDownload.description",
        keywords: ["sync", "download", "auto", "merge", "restore"],
      },
    ],
  },
  {
    id: "advanced",
    labelKey: "settings.advanced.label",
    settings: [],
  },
];

/** Every setting definition in sidebar order. */
const ALL_SETTING_DEFS: readonly SettingDef[] = SETTINGS_SCHEMA.flatMap(
  (category) => category.settings,
);

const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDef> = new Map(
  ALL_SETTING_DEFS.map((def) => [def.key, def] as const),
);

/** Unique dotted keys of all 36 settings, in schema order. */
export const SETTING_KEYS: readonly string[] = ALL_SETTING_DEFS.map((def) => def.key);

function cloneDefaultValue(value: SettingDef["default"]): boolean | number | string | string[] {
  return Array.isArray(value) ? [...value] : value;
}

function createDefaultSettings(): Settings {
  const value: Settings = {};
  for (const def of ALL_SETTING_DEFS) value[def.key] = cloneDefaultValue(def.default);
  return value;
}

/** All default setting values, keyed like the persisted settings object. */
export const DEFAULT_SETTINGS: Settings = createDefaultSettings();

/** Look up a setting definition; unknown keys return undefined. */
export function getSettingDef(key: string): SettingDef | undefined {
  return SETTINGS_BY_KEY.get(key);
}

type FieldValidation =
  | { ok: true; value: boolean | number | string | string[] }
  | { ok: false; reason: string };

function validateField(def: SettingDef, raw: unknown): FieldValidation {
  switch (def.type) {
    case "boolean":
      return typeof raw === "boolean"
        ? { ok: true, value: raw }
        : { ok: false, reason: "must be a boolean" };
    case "enum":
      if (typeof raw === "string" || typeof raw === "number") {
        if (def.values.includes(raw)) return { ok: true, value: raw };
      }
      return { ok: false, reason: `must be one of: ${def.values.join(", ")}` };
    case "number":
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < def.min || raw > def.max) {
        return { ok: false, reason: `must be a number between ${def.min} and ${def.max}` };
      }
      return { ok: true, value: raw };
    case "string-list":
      if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
        return { ok: false, reason: "must be an array of strings" };
      }
      if (raw.length > def.maxItems) {
        return { ok: false, reason: `must contain at most ${def.maxItems} items` };
      }
      return { ok: true, value: [...raw] };
  }
}

/**
 * Validate a stored or imported settings object.
 *
 * Unknown keys are dropped, missing keys fall back to defaults, and every
 * invalid field contributes exactly one error. A fully valid result contains
 * all 36 settings.
 */
export function validateSettings(
  input: unknown,
): { ok: true; value: Settings } | { ok: false; errors: string[] } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["settings must be an object"] };
  }

  const value = createDefaultSettings();
  const errors: string[] = [];

  for (const [key, raw] of Object.entries(input)) {
    const def = getSettingDef(key);
    if (!def) continue;
    const field = validateField(def, raw);
    if (field.ok) value[key] = field.value;
    else errors.push(`${key}: ${field.reason}`);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
