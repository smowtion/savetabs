import { SETTINGS_SCHEMA } from "@savetabs/shared";
import { describe, expect, it } from "vitest";

import { filterSettings } from "./search-settings";

describe("filterSettings", () => {
  it("finds memory settings from hidden English keywords in both languages", () => {
    for (const lang of ["en", "vi"] as const) {
      const groups = filterSettings("discard", lang);

      expect(groups.map((group) => group.category)).toEqual(["memory"]);
      expect(groups[0]?.settings.map((setting) => setting.key)).toEqual([
        "memory.autoDiscard",
        "memory.timeoutMinutes",
        "memory.keepAudible",
        "memory.keepPinned",
      ]);
    }
  });

  it("matches translated labels and descriptions in Vietnamese", () => {
    const byCategoryLabel = filterSettings("tiết kiệm bộ nhớ", "vi");
    expect(byCategoryLabel.map((group) => group.category)).toEqual(["memory"]);
    expect(byCategoryLabel[0]?.settings).toHaveLength(4);

    const byDescription = filterSettings("giải phóng", "vi");
    expect(byDescription.map((group) => group.category)).toEqual(["memory"]);
    expect(byDescription[0]?.settings).toHaveLength(4);

    const bySettingLabel = filterSettings("tên miền loại trừ", "vi");
    expect(bySettingLabel.map((group) => group.category)).toEqual(["tabs"]);
    expect(bySettingLabel[0]?.settings.map((setting) => setting.key)).toEqual([
      "tabs.excludedDomains",
    ]);
  });

  it("matches setting keys, English labels and descriptions", () => {
    const byKey = filterSettings("excludedDomains", "en");
    expect(byKey.map((group) => group.category)).toEqual(["tabs"]);
    expect(byKey[0]?.settings.map((setting) => setting.key)).toEqual([
      "tabs.excludedDomains",
    ]);

    const byDescription = filterSettings("toolbar icon", "en");
    const keys = byDescription.flatMap((group) =>
      group.settings.map((setting) => setting.key),
    );
    expect(keys).toContain("general.showBadgeCount");
    expect(keys).toContain("open.toolbarAction");

    const byCategoryLabel = filterSettings("memory saver", "en");
    expect(byCategoryLabel.map((group) => group.category)).toEqual(["memory"]);
    expect(byCategoryLabel[0]?.settings).toHaveLength(4);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(filterSettings("  DISCARD  ", "en")).toEqual(
      filterSettings("discard", "en"),
    );
  });

  it("returns every category and setting for an empty query", () => {
    const groups = filterSettings("   ", "en");

    expect(groups.map((group) => group.category)).toEqual(
      SETTINGS_SCHEMA.map((category) => category.id),
    );
    expect(groups.flatMap((group) => group.settings)).toHaveLength(36);
  });

  it("returns no groups when nothing matches", () => {
    expect(filterSettings("zzzz-no-match", "en")).toEqual([]);
  });
});
