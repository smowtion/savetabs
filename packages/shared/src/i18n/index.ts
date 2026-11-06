/**
 * Tiny i18n core shared by the extension UI and the web app.
 *
 * Dictionaries are nested JSON objects imported at build time and flattened
 * once into dotted-path maps (`settings.tabs.saveAllWindows.label`). Lookups
 * never throw: an unknown key returns the key itself so missing strings are
 * visible in the UI instead of blanking a screen.
 */

import ar from "./ar.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import hi from "./hi.json";
import ja from "./ja.json";
import pt from "./pt.json";
import ru from "./ru.json";
import vi from "./vi.json";
import zhCN from "./zh-CN.json";
import { LANGS } from "./locales";

/** Supported UI languages. */
export type Lang =
  | "en"
  | "vi"
  | "zh-CN"
  | "es"
  | "hi"
  | "ar"
  | "pt"
  | "ru"
  | "ja"
  | "fr";

/** Stored `general.language` preference; "auto" follows the browser language. */
export type LanguagePreference = "auto" | Lang;

/** True when a stored value is a supported language code. */
export function isLang(value: unknown): value is Lang {
  return (
    typeof value === "string" && (LANGS as readonly string[]).includes(value)
  );
}

/** True when a stored value is a usable `general.language` preference. */
export function isLanguagePreference(
  value: unknown,
): value is LanguagePreference {
  return value === "auto" || isLang(value);
}

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
  "zh-CN": flattenDictionary(zhCN as Dictionary),
  es: flattenDictionary(es as Dictionary),
  hi: flattenDictionary(hi as Dictionary),
  ar: flattenDictionary(ar as Dictionary),
  pt: flattenDictionary(pt as Dictionary),
  ru: flattenDictionary(ru as Dictionary),
  ja: flattenDictionary(ja as Dictionary),
  fr: flattenDictionary(fr as Dictionary),
};

/**
 * Browser language prefixes mapped to the closest supported locale.
 *
 * Later locales append one entry here; order does not matter because the
 * prefixes do not overlap.
 */
const BROWSER_LANG_PREFIXES: readonly (readonly [string, Lang])[] = [
  ["zh", "zh-CN"],
  ["es", "es"],
  ["vi", "vi"],
  ["hi", "hi"],
  ["ar", "ar"],
  ["pt", "pt"],
  ["ru", "ru"],
  ["ja", "ja"],
  ["fr", "fr"],
];

/**
 * Resolve the language to render.
 *
 * An explicit supported preference always wins. `"auto"` (or any unknown
 * value) follows the browser language through the prefix table above, with
 * English as the final fallback. Regional variants (e.g. `zh-TW`) map to the
 * closest supported locale.
 */
export function resolveLang(preference: LanguagePreference, navigatorLang: string): Lang {
  if (isLang(preference)) return preference;

  const browserLang = navigatorLang.toLowerCase();
  const match = BROWSER_LANG_PREFIXES.find(([prefix]) =>
    browserLang.startsWith(prefix),
  );
  return match?.[1] ?? "en";
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

export * from "./locales";
