import { describe, it, expect } from "vitest";
import { SETTINGS_SCHEMA } from "../settings-schema";
import { createTranslator, missingKeys, resolveLang } from "./index";

describe("i18n", () => {
  it("resolves language and covers every schema string", () => {
    expect(resolveLang("auto", "vi-VN")).toBe("vi");
    expect(resolveLang("auto", "en-US")).toBe("en");
    const needed = SETTINGS_SCHEMA.flatMap(c => [
      c.labelKey, ...c.settings.flatMap(s => [s.labelKey, s.descriptionKey]),
    ]);
    expect(missingKeys("en", needed)).toEqual([]);
    expect(missingKeys("vi", needed)).toEqual([]);
    expect(createTranslator("en")("common.tabsCount", { count: 3 })).toContain("3");
  });

  it("honors explicit language overrides", () => {
    expect(resolveLang("vi", "en-US")).toBe("vi");
    expect(resolveLang("en", "vi-VN")).toBe("en");
    expect(resolveLang("auto", "fr-FR")).toBe("en");
  });

  it("falls back to the key itself for missing translations", () => {
    expect(createTranslator("en")("missing.key")).toBe("missing.key");
  });

  it("reports only the keys missing from a dictionary", () => {
    expect(missingKeys("vi", ["common.restore", "nope.missing"])).toEqual(["nope.missing"]);
  });

  it("covers the options shell strings in both languages", () => {
    const shellKeys = [
      "options.search",
      "options.searchPlaceholder",
      "options.expandAll",
      "options.collapseAll",
      "options.categories",
      "options.settingCount",
      "options.saved",
      "options.noResults",
      "options.theme.system",
      "options.theme.light",
      "options.theme.dark",
      "options.theme.toggle",
      ...SETTINGS_SCHEMA.map((category) => `settings.${category.id}.description`),
    ];

    expect(missingKeys("en", shellKeys)).toEqual([]);
    expect(missingKeys("vi", shellKeys)).toEqual([]);
  });
});
