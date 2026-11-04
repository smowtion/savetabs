/**
 * Renders every setting of one category by dispatching on its schema type.
 *
 * There are no per-setting hardcoded rows: adding a setting to the schema is
 * enough for it to appear here. Enum option labels come from
 * `settings.option.<settingKey>.<value>` and fall back to the raw value when a
 * translation is missing. Memory settings are disabled when the browser lacks
 * `tabs.discard`, with a note explaining the dead feature.
 */

import type {
  CategoryId,
  SettingDef,
  Settings,
  Translator,
} from "@savetabs/shared";
import type { ReactNode } from "react";

import type { SettingValue } from "../lib/settings";
import { NumberInput } from "./NumberInput";
import { Select } from "./Select";
import { SettingRow, settingControlId } from "./SettingRow";
import { StringListInput } from "./StringListInput";
import { Toggle } from "./Toggle";

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

export function CategorySection({
  categoryId,
  settings,
  values,
  t,
  onChange,
  discardSupported,
}: CategorySectionProps) {
  if (settings.length === 0) return null;

  const memoryDisabled = categoryId === "memory" && !discardSupported;
  const unsupportedNote = memoryDisabled
    ? t("options.memoryUnsupported")
    : undefined;

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
        const disabled = memoryDisabled;
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
            note={unsupportedNote}
            disabled={disabled}
          >
            {control}
          </SettingRow>
        );
      })}
    </div>
  );
}
