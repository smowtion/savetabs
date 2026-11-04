import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OPEN_SECTIONS_STORAGE_KEY,
  loadOpenSections,
  sanitizeOpenSections,
  saveOpenSections,
} from "./open-sections";

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
});

describe("sanitizeOpenSections", () => {
  it("keeps known category ids once and drops everything else", () => {
    expect(
      sanitizeOpenSections([
        "memory",
        "memory",
        "not-a-category",
        7,
        null,
        "general",
      ]),
    ).toEqual(["memory", "general"]);
  });

  it("returns an empty list for non-array values", () => {
    expect(sanitizeOpenSections(undefined)).toEqual([]);
    expect(sanitizeOpenSections("memory")).toEqual([]);
    expect(sanitizeOpenSections({ 0: "memory" })).toEqual([]);
  });
});

describe("open section persistence", () => {
  it("saves and loads section ids", async () => {
    await saveOpenSections(["tabs", "memory"]);

    await expect(loadOpenSections()).resolves.toEqual(["tabs", "memory"]);
    await expect(
      fakeBrowser.storage.local.get(OPEN_SECTIONS_STORAGE_KEY),
    ).resolves.toEqual({ [OPEN_SECTIONS_STORAGE_KEY]: ["tabs", "memory"] });
  });

  it("sanitizes stored values on load", async () => {
    await fakeBrowser.storage.local.set({
      [OPEN_SECTIONS_STORAGE_KEY]: ["advanced", "bogus", "advanced"],
    });

    await expect(loadOpenSections()).resolves.toEqual(["advanced"]);
  });

  it("falls back to an empty list when storage is empty or unreadable", async () => {
    await expect(loadOpenSections()).resolves.toEqual([]);

    vi.spyOn(fakeBrowser.storage.local, "get").mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await expect(loadOpenSections()).resolves.toEqual([]);
  });
});
