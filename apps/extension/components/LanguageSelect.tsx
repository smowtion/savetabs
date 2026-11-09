/**
 * Compact language picker for the toolbar popup.
 *
 * The popup is the fastest place to switch languages, so the control lives in
 * the header instead of the options page. Native language names come from the
 * shared locale registry; "auto" follows the browser language. The caller is
 * responsible for persisting the choice.
 */

import {
  LOCALES,
  type LanguagePreference,
  type Translator,
} from "@savetabs/shared";
import { ChevronDown, Globe } from "lucide-react";

export type LanguageSelectProps = {
  value: LanguagePreference;
  onChange: (value: LanguagePreference) => void;
  t: Translator;
};

export function LanguageSelect({ value, onChange, t }: LanguageSelectProps) {
  return (
    <label className="relative inline-flex max-w-[9.5rem] items-center">
      <span className="sr-only">{t("settings.general.language.label")}</span>
      <Globe
        aria-hidden="true"
        className="pointer-events-none absolute start-2 h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400"
      />
      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value as LanguagePreference)
        }
        className="w-full appearance-none rounded-md border border-neutral-300 bg-white py-1.5 ps-7 pe-6 text-xs text-neutral-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <option value="auto">{t("popup.languageAuto")}</option>
        {LOCALES.map((locale) => (
          <option key={locale.code} value={locale.code}>
            {locale.name}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute end-1.5 h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400"
      />
    </label>
  );
}
