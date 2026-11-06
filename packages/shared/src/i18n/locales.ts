/**
 * Locale registry shared by the extension, the web app and the settings UI.
 *
 * `name` is the native language name shown in language pickers; `dir` drives
 * the document direction when a locale is selected.
 */

import type { Lang } from "./index";

/** One supported UI locale. */
export type Locale = {
  code: Lang;
  name: string;
  dir: "ltr" | "rtl";
};

/** Every supported locale, in display order. */
export const LOCALES: readonly Locale[] = [
  { code: "en", name: "English", dir: "ltr" },
  { code: "vi", name: "Tiếng Việt", dir: "ltr" },
  { code: "zh-CN", name: "简体中文", dir: "ltr" },
  { code: "es", name: "Español", dir: "ltr" },
  { code: "hi", name: "हिन्दी", dir: "ltr" },
  { code: "ar", name: "العربية", dir: "rtl" },
  { code: "pt", name: "Português", dir: "ltr" },
  { code: "ru", name: "Русский", dir: "ltr" },
  { code: "ja", name: "日本語", dir: "ltr" },
  { code: "fr", name: "Français", dir: "ltr" },
];

/** Locale codes in display order, for settings enums and validation. */
export const LANGS: readonly Lang[] = LOCALES.map((locale) => locale.code);

/** Writing direction for a locale; unknown codes default to left-to-right. */
export function localeDir(lang: Lang): "ltr" | "rtl" {
  return LOCALES.find((locale) => locale.code === lang)?.dir ?? "ltr";
}
