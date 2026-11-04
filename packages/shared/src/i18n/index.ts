/**
 * Tiny i18n core shared by the extension UI and the web app.
 *
 * Dictionaries are nested JSON objects imported at build time and flattened
 * once into dotted-path maps (`settings.tabs.saveAllWindows.label`). Lookups
 * never throw: an unknown key returns the key itself so missing strings are
 * visible in the UI instead of blanking a screen.
 */

import en from "./en.json";
import vi from "./vi.json";

/** Supported UI languages. */
export type Lang = "en" | "vi";

/** Stored `general.language` preference; "auto" follows the browser language. */
export type LanguagePreference = "auto" | Lang;

/** Values available to `{placeholder}` interpolation in dictionary strings. */
export type TranslationVars = Record<string, string | number>;

/** Translation function returned by {@link createTranslator}. */
export type Translator = (key: string, vars?: TranslationVars) => string;

type Dictionary = Record<string, unknown>;
type FlatDictionary = ReadonlyMap<string, string>;

/** Flatten nested dictionary objects into dotted keys; only strings are leaves. */
function flattenDictionary(
  dictionary: Dictionary,
  prefix = "",
  out = new Map<string, string>(),
): FlatDictionary {
  for (const [key, value] of Object.entries(dictionary)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") {
      out.set(path, value);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      flattenDictionary(value as Dictionary, path, out);
    }
  }
  return out;
}

const FLAT_DICTIONARIES: Readonly<Record<Lang, FlatDictionary>> = {
  en: flattenDictionary(en as Dictionary),
  vi: flattenDictionary(vi as Dictionary),
};

/**
 * Resolve the language to render.
 *
 * An explicit `"en"`/`"vi"` preference always wins. `"auto"` (or any unknown
 * value) follows the browser language: `vi*` renders Vietnamese, everything
 * else falls back to English.
 */
export function resolveLang(preference: LanguagePreference, navigatorLang: string): Lang {
  if (preference === "en" || preference === "vi") return preference;
  return navigatorLang.toLowerCase().startsWith("vi") ? "vi" : "en";
}

/** Replace `{name}` placeholders; unknown placeholders are left untouched. */
function interpolate(template: string, vars: TranslationVars): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = vars[name];
    return value === undefined ? placeholder : String(value);
  });
}

/**
 * Create a translator bound to one language.
 *
 * Missing keys fall back to the key itself, and missing interpolation values
 * leave their `{placeholder}` in place so the defect is visible in development.
 */
export function createTranslator(lang: Lang): Translator {
  const dictionary = FLAT_DICTIONARIES[lang];
  return (key, vars) => {
    const template = dictionary.get(key);
    if (template === undefined) return key;
    return vars === undefined ? template : interpolate(template, vars);
  };
}

/** Return the subset of `keys` that is missing from the language dictionary. */
export function missingKeys(lang: Lang, keys: readonly string[]): string[] {
  const dictionary = FLAT_DICTIONARIES[lang];
  return keys.filter((key) => !dictionary.has(key));
}
