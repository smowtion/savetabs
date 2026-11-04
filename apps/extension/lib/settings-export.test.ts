import { DEFAULT_SETTINGS } from "@savetabs/shared";
import { describe, expect, it } from "vitest";

import { exportSettingsFile, importSettingsFile } from "./settings-export";

const HEADER = { app: "savetabs", kind: "settings", version: 1 } as const;

function settingsFile(settings: unknown, header: object = HEADER): string {
  return JSON.stringify({
    ...header,
    exportedAt: new Date().toISOString(),
    settings,
  });
}

describe("exportSettingsFile", () => {
  it("writes the documented header and every setting", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      "general.theme": "dark",
      "tabs.excludedDomains": ["example.com"],
      "memory.timeoutMinutes": 60,
    };

    const parsed = JSON.parse(exportSettingsFile(settings)) as {
      app: unknown;
      kind: unknown;
      version: unknown;
      exportedAt: unknown;
      settings: unknown;
    };

    expect(parsed.app).toBe("savetabs");
    expect(parsed.kind).toBe("settings");
    expect(parsed.version).toBe(1);
    expect(typeof parsed.exportedAt).toBe("string");
    expect(new Date(parsed.exportedAt as string).toISOString()).toBe(
      parsed.exportedAt,
    );
    expect(parsed.settings).toEqual(settings);
  });
});

describe("importSettingsFile", () => {
  it("round-trips an exported file", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      "general.language": "vi",
      "sync.enabled": true,
      "general.confirmThreshold": 40,
      "tabs.excludedDomains": ["one.example", "two.example"],
    };

    expect(importSettingsFile(exportSettingsFile(settings))).toEqual({
      ok: true,
      settings,
    });
  });

  it("returns field-level errors and applies nothing", () => {
    const result = importSettingsFile(
      settingsFile({
        "general.theme": "neon",
        "general.confirmThreshold": 9999,
        "tabs.closeAfterSave": false,
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining("general.theme"),
          expect.stringContaining("general.confirmThreshold"),
        ]),
      );
    }
    expect(result).not.toHaveProperty("settings");
  });

  it("rejects malformed JSON and wrong headers", () => {
    expect(importSettingsFile("{not json").ok).toBe(false);
    expect(importSettingsFile(JSON.stringify([])).ok).toBe(false);
    expect(importSettingsFile(JSON.stringify(null)).ok).toBe(false);
    expect(
      importSettingsFile(settingsFile({}, { ...HEADER, app: "other" })).ok,
    ).toBe(false);
    expect(
      importSettingsFile(settingsFile({}, { ...HEADER, kind: "sessions" })).ok,
    ).toBe(false);
    expect(
      importSettingsFile(settingsFile({}, { ...HEADER, version: 2 })).ok,
    ).toBe(false);
    expect(importSettingsFile(settingsFile([])).ok).toBe(false);
  });

  it("drops unknown keys and fills missing keys with defaults", () => {
    const result = importSettingsFile(
      settingsFile({ "general.theme": "dark", "not.a.setting": true }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings["general.theme"]).toBe("dark");
      expect(result.settings["memory.timeoutMinutes"]).toBe(
        DEFAULT_SETTINGS["memory.timeoutMinutes"],
      );
      expect(result.settings).not.toHaveProperty("not.a.setting");
      expect(Object.keys(result.settings)).toHaveLength(
        Object.keys(DEFAULT_SETTINGS).length,
      );
    }
  });
});
