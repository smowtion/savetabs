import {
  createTranslator,
  resolveLang,
  type Lang,
  type Translator,
} from "@savetabs/shared";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Language and translator for the web app.
 *
 * The first visit follows the browser language through
 * `resolveLang("auto", navigator.language)`. Choosing a language through the
 * header toggle stores it locally and wins on later visits.
 */

/** Local preference key; intentionally separate from extension settings. */
export const LANGUAGE_STORAGE_KEY = "web-language";

export type UseI18nResult = {
  lang: Lang;
  t: Translator;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
};

function browserLanguage(): string {
  return typeof navigator === "undefined" ? "en" : navigator.language;
}

function readStoredLang(): Lang | null {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored === "en" || stored === "vi" ? stored : null;
  } catch {
    return null;
  }
}

function storeLang(lang: Lang): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Language still works for this page when storage is unavailable.
  }
}

export function useI18n(): UseI18nResult {
  const [lang, setLangState] = useState<Lang>(
    () => readStoredLang() ?? resolveLang("auto", browserLanguage()),
  );
  const t = useMemo(() => createTranslator(lang), [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    storeLang(next);
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === "en" ? "vi" : "en");
  }, [lang, setLang]);

  return { lang, t, setLang, toggleLang };
}
