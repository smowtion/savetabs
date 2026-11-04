import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  SETTINGS_SCHEMA,
  getSettingDef,
  validateSettings,
} from "./settings-schema";

describe("settings schema", () => {
  it("has 14 categories and 36 unique settings", () => {
    expect(SETTINGS_SCHEMA).toHaveLength(14);
    expect(SETTING_KEYS).toHaveLength(36);
    expect(new Set(SETTING_KEYS).size).toBe(36);
    expect(DEFAULT_SETTINGS["memory.timeoutMinutes"]).toBe(30);
    expect(DEFAULT_SETTINGS["sync.enabled"]).toBe(false);
    expect(DEFAULT_SETTINGS["open.toolbarAction"]).toBe("popup");
  });

  it("keeps the plan category order", () => {
    expect(SETTINGS_SCHEMA.map((category) => category.id)).toEqual([
      "general",
      "tabs",
      "duplicates",
      "pinned",
      "open",
      "urlDisplay",
      "restore",
      "clipboard",
      "contextMenu",
      "memory",
      "shortcuts",
      "incognito",
      "sync",
      "advanced",
    ]);
  });

  it("gives every setting i18n keys and a keywords list shape", () => {
    for (const category of SETTINGS_SCHEMA) {
      expect(category.labelKey).toBe(`settings.${category.id}.label`);
      for (const def of category.settings) {
        expect(def.key.startsWith(`${category.id}.`)).toBe(true);
        expect(def.labelKey).toBe(`settings.${def.key}.label`);
        expect(def.descriptionKey).toBe(`settings.${def.key}.description`);
        if (def.keywords !== undefined) {
          expect(def.keywords.length).toBeGreaterThan(0);
          for (const keyword of def.keywords) expect(keyword.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("exposes only the zero-setting categories as empty", () => {
    const empty = SETTINGS_SCHEMA.filter((category) => category.settings.length === 0);
    expect(empty.map((category) => category.id)).toEqual(["shortcuts", "advanced"]);
  });

  it("keeps every default consistent with its definition", () => {
    for (const category of SETTINGS_SCHEMA) {
      for (const def of category.settings) {
        expect(DEFAULT_SETTINGS[def.key]).toEqual(def.default);
        switch (def.type) {
          case "boolean":
            expect(typeof def.default).toBe("boolean");
            break;
          case "enum":
            expect(def.values).toContain(def.default);
            break;
          case "number":
            expect(def.default).toBeGreaterThanOrEqual(def.min);
            expect(def.default).toBeLessThanOrEqual(def.max);
            break;
          case "string-list":
            expect(Array.isArray(def.default)).toBe(true);
            break;
        }
      }
    }
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([...SETTING_KEYS].sort());
  });

  it("finds definitions by key", () => {
    expect(getSettingDef("memory.timeoutMinutes")?.type).toBe("enum");
    expect(getSettingDef("tabs.excludedDomains")?.type).toBe("string-list");
    expect(getSettingDef("shortcuts.notARealKey")).toBeUndefined();
  });
});

describe("validateSettings", () => {
  it("rejects invalid values with field errors", () => {
    const bad = validateSettings({ "memory.timeoutMinutes": 7, "general.theme": "blue" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toHaveLength(2);
  });

  it("merges valid partial input over defaults and drops unknown keys", () => {
    const result = validateSettings({ "general.theme": "dark", "made.up.key": 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value["general.theme"]).toBe("dark");
      expect(result.value["memory.timeoutMinutes"]).toBe(30);
      expect(result.value).not.toHaveProperty("made.up.key");
      expect(Object.keys(result.value)).toHaveLength(36);
    }
  });

  it("returns a complete copy of the defaults for empty input", () => {
    const result = validateSettings({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(DEFAULT_SETTINGS);
  });

  it("accepts the numeric memory timeout enum", () => {
    const result = validateSettings({ "memory.timeoutMinutes": 60 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value["memory.timeoutMinutes"]).toBe(60);
  });

  it("rejects every wrong value type with one error per field", () => {
    const result = validateSettings({
      "general.showBadgeCount": "yes",
      "general.confirmThreshold": 501,
      "tabs.excludedDomains": ["a.com", 2],
      "open.toolbarAction": "new-tab",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(4);
      const text = result.errors.join("\n");
      expect(text).toContain("general.showBadgeCount");
      expect(text).toContain("general.confirmThreshold");
      expect(text).toContain("tabs.excludedDomains");
      expect(text).toContain("open.toolbarAction");
    }
  });

  it("enforces the string-list maxItems cap", () => {
    const def = getSettingDef("tabs.excludedDomains");
    if (!def || def.type !== "string-list") throw new Error("missing string-list definition");
    const atLimit = Array.from({ length: def.maxItems }, (_, index) => `d${index}.com`);
    expect(validateSettings({ "tabs.excludedDomains": atLimit }).ok).toBe(true);
    const overLimit = [...atLimit, "extra.com"];
    expect(validateSettings({ "tabs.excludedDomains": overLimit }).ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validateSettings(null).ok).toBe(false);
    expect(validateSettings([]).ok).toBe(false);
    expect(validateSettings("settings").ok).toBe(false);
  });

  it("does not mutate the shared defaults", () => {
    const result = validateSettings({ "tabs.excludedDomains": ["a.com"] });
    expect(result.ok).toBe(true);
    expect(DEFAULT_SETTINGS["tabs.excludedDomains"]).toEqual([]);
  });
});
