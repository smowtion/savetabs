/**
 * Renders every setting of one category by dispatching on its schema type.
 *
 * There are no per-setting hardcoded rows: adding a setting to the schema is
 * enough for it to appear here. Enum option labels come from
 * `settings.option.<settingKey>.<value>` and fall back to the raw value when a
 * translation is missing. Memory settings are disabled when the browser lacks
 * `tabs.discard`, with a note explaining the dead feature.
 *
 * Two categories carry extra content besides their schema settings:
 * `incognito` reports whether the extension may run in private windows and
 * disables `incognito.includeInSaveAll` while access is missing, and
 * `shortcuts` lists the bindings the browser currently has assigned.
 */

import type {
  CategoryId,
  SettingDef,
  Settings,
  Translator,
} from "@savetabs/shared";
import { useEffect, useState, type ReactNode } from "react";

import { copyText } from "../lib/clipboard-write";
import { EXTENSIONS_PAGE_PATH, isIncognitoAllowed } from "../lib/incognito";
import type { SettingValue } from "../lib/settings";
import { AdvancedActions } from "./AdvancedActions";
import { NumberInput } from "./NumberInput";
import { Select } from "./Select";
import { SettingRow, settingControlId } from "./SettingRow";
import { ShortcutsInfo } from "./ShortcutsInfo";
import { StringListInput } from "./StringListInput";
import { Toggle } from "./Toggle";

const BUTTON_CLASS =
  "rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";

export type CategorySectionProps = {
  categoryId: CategoryId;
  settings: readonly SettingDef[];
  /** Null until the settings store has loaded; defaults render meanwhile. */
  values: Settings | null;
  t: Translator;
  onChange: (key: string, value: SettingValue) => void | Promise<void>;
  /** False on browsers without `tabs.discard` (Firefox builds). */
  discardSupported: boolean;
};

function enumOptionLabel(
  t: Translator,
  key: string,
  value: string | number,
): string {
  const labelKey = `settings.option.${key}.${String(value)}`;
  const translated = t(labelKey);
  return translated === labelKey ? String(value) : translated;
}

type SettingsListProps = Pick<
  CategorySectionProps,
  "settings" | "values" | "t" | "onChange"
> & {
  /** Disables every control, e.g. when the browser lacks the feature. */
  disabled?: boolean;
  /** Why the controls are disabled; rendered under every description. */
  note?: string;
};

/** Schema-driven rows shared by the plain and incognito category bodies. */
function SettingsList({
  settings,
  values,
  t,
  onChange,
  disabled = false,
  note,
}: SettingsListProps) {
  async function write(key: string, value: SettingValue): Promise<void> {
    try {
      await onChange(key, value);
    } catch (error) {
      // The settings store validates every write; a rejection here means the
      // control produced an impossible value. Keep the page usable and log it.
      console.error(`[savetabs] failed to save setting ${key}`, error);
    }
  }

  return (
    <div className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
      {settings.map((def) => {
        const controlId = settingControlId(def.key);
        const raw = values?.[def.key];
        let control: ReactNode = null;

        switch (def.type) {
          case "boolean": {
            const checked = typeof raw === "boolean" ? raw : def.default;
            control = (
              <Toggle
                id={controlId}
                checked={checked}
                label={t(def.labelKey)}
                disabled={disabled}
                onChange={(next) => {
                  void write(def.key, next);
                }}
              />
            );
            break;
          }
          case "enum": {
            const current =
              typeof raw === "string" || typeof raw === "number"
                ? raw
                : def.default;
            const currentText = def.values.some(
              (value) => String(value) === String(current),
            )
              ? String(current)
              : String(def.default);
            control = (
              <Select
                id={controlId}
                value={currentText}
                label={t(def.labelKey)}
                disabled={disabled}
                options={def.values.map((value) => ({
                  value: String(value),
                  label: enumOptionLabel(t, def.key, value),
                }))}
                onChange={(next) => {
                  const match = def.values.find(
                    (value) => String(value) === next,
                  );
                  // Numeric enums (memory.timeoutMinutes) save as numbers.
                  void write(def.key, match === undefined ? next : match);
                }}
              />
            );
            break;
          }
          case "number": {
            const current =
              typeof raw === "number" && Number.isFinite(raw)
                ? raw
                : def.default;
            control = (
              <NumberInput
                id={controlId}
                value={current}
                min={def.min}
                max={def.max}
                step={def.step ?? 1}
                label={t(def.labelKey)}
                disabled={disabled}
                invalidMessage={t("options.validation.numberRange", {
                  min: def.min,
                  max: def.max,
                })}
                onChange={(next) => {
                  void write(def.key, next);
                }}
              />
            );
            break;
          }
          case "string-list": {
            const current = Array.isArray(raw)
              ? raw.filter((item): item is string => typeof item === "string")
              : [...def.default];
            control = (
              <StringListInput
                id={controlId}
                value={current}
                maxItems={def.maxItems}
                label={t(def.labelKey)}
                disabled={disabled}
                placeholder={t("options.stringList.placeholder")}
                addLabel={t("options.stringList.add")}
                removeLabel={(item) =>
                  t("options.stringList.remove", { item })
                }
                emptyMessage={t("options.validation.emptyEntry")}
                duplicateMessage={t("options.validation.duplicateEntry")}
                maxItemsMessage={t("options.validation.maxItems", {
                  count: def.maxItems,
                })}
                onChange={(items) => {
                  void write(def.key, items);
                }}
              />
            );
            break;
          }
        }

        return (
          <SettingRow
            key={def.key}
            settingKey={def.key}
            label={t(def.labelKey)}
            description={t(def.descriptionKey)}
            tooltip={{
              text: t(def.descriptionKey),
              label: t("options.tooltip", { setting: t(def.labelKey) }),
            }}
            note={note}
            disabled={disabled}
          >
            {control}
          </SettingRow>
        );
      })}
    </div>
  );
}

type IncognitoSectionProps = Pick<
  CategorySectionProps,
  "settings" | "values" | "t" | "onChange"
>;

type CopyStatus = "success" | "error";

/**
 * Incognito status plus the schema rows.
 *
 * Access is checked on mount and re-checked whenever the options page becomes
 * visible or focused again: the user grants the permission on the browser's
 * extensions page, then comes back to this still-mounted panel, which must not
 * keep showing the stale answer. The setting is disabled when the browser
 * reports no access, because the control could never take effect in that
 * state.
 */
function IncognitoSection({
  settings,
  values,
  t,
  onChange,
}: IncognitoSectionProps) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);

  useEffect(() => {
    let active = true;

    function refresh(): void {
      void isIncognitoAllowed().then((value) => {
        if (active) setAllowed(value);
      });
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") refresh();
    }

    refresh();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", refresh);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  async function copyPath(): Promise<void> {
    try {
      await copyText(EXTENSIONS_PAGE_PATH);
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }
  }

  const denied = allowed === false;
  const statusClass =
    allowed === null
      ? "text-neutral-500 dark:text-neutral-400"
      : allowed
        ? "text-green-600 dark:text-green-400"
        : "text-amber-600 dark:text-amber-400";

  return (
    <div className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
      <div
        data-testid="incognito-status"
        className="flex items-start justify-between gap-4 py-3"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {t("settings.incognito.status.label")}
          </p>
          <p role="status" className={`mt-0.5 text-xs ${statusClass}`}>
            {allowed === null
              ? t("common.loading")
              : allowed
                ? t("settings.incognito.status.allowed")
                : t("settings.incognito.status.denied")}
          </p>
        </div>
      </div>

      {denied && (
        <div className="py-3">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {t("settings.incognito.enableInstructions")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code
              aria-label={t("settings.incognito.pagePathLabel")}
              className="min-w-0 break-all rounded-md bg-neutral-100 px-2 py-1 font-mono text-xs dark:bg-neutral-800"
            >
              {EXTENSIONS_PAGE_PATH}
            </code>
            <button
              type="button"
              onClick={() => void copyPath()}
              className={BUTTON_CLASS}
            >
              {t("settings.incognito.copyPath")}
            </button>
          </div>
          {copyStatus !== null && (
            <p
              role={copyStatus === "success" ? "status" : "alert"}
              className={`mt-1 text-xs ${
                copyStatus === "success"
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {copyStatus === "success"
                ? t("settings.incognito.copySuccess")
                : t("settings.incognito.copyFailed")}
            </p>
          )}
        </div>
      )}

      <SettingsList
        settings={settings}
        values={values}
        t={t}
        onChange={onChange}
        disabled={denied}
        note={denied ? t("settings.incognito.deniedNote") : undefined}
      />
    </div>
  );
}

export function CategorySection({
  categoryId,
  settings,
  values,
  t,
  onChange,
  discardSupported,
}: CategorySectionProps) {
  // The Advanced category holds actions instead of schema settings; it owns
  // its own import/export/reset UI.
  if (categoryId === "advanced") {
    return <AdvancedActions settings={values} t={t} />;
  }

  // Shortcuts has no schema settings at all; the browser owns the bindings.
  if (categoryId === "shortcuts") {
    return <ShortcutsInfo t={t} />;
  }

  if (settings.length === 0) return null;

  if (categoryId === "incognito") {
    return (
      <IncognitoSection
        settings={settings}
        values={values}
        t={t}
        onChange={onChange}
      />
    );
  }

  const memoryDisabled = categoryId === "memory" && !discardSupported;

  return (
    <SettingsList
      settings={settings}
      values={values}
      t={t}
      onChange={onChange}
      disabled={memoryDisabled}
      note={memoryDisabled ? t("options.memoryUnsupported") : undefined}
    />
  );
}
