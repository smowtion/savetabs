/**
 * Language and translator for React surfaces.
 *
 * `general.language` may be `auto`, so the browser language is resolved once
 * per render through the shared i18n helpers. The translator is memoized so
 * components can depend on its identity safely. The document `lang` and `dir`
 * attributes follow the resolved language, so Arabic renders every extension
 * surface right-to-left.
 */

import {
  createTranslator,
  isLanguagePreference,
  localeDir,
  resolveLang,
  type Lang,
  type LanguagePreference,
  type Translator,
} from "@savetabs/shared";
import { useEffect, useMemo } from "react";

export type UseI18nResult = {
  lang: Lang;
  t: Translator;
};

function normalizePreference(value: unknown): LanguagePreference {
  return isLanguagePreference(value) ? value : "auto";
}

function browserLanguage(): string {
  return typeof navigator === "undefined" ? "en" : navigator.language;
}

/** Resolve the stored language preference and return its translator. */
export function useI18n(preference: unknown): UseI18nResult {
  const lang = resolveLang(normalizePreference(preference), browserLanguage());
  const t = useMemo(() => createTranslator(lang), [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = localeDir(lang);
  }, [lang]);

  return { lang, t };
}
