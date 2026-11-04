import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXTENSIONS_PAGE_PATH, isIncognitoAllowed } from "./incognito";

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
});

describe("isIncognitoAllowed", () => {
  it("reports access when the browser allows the extension in incognito", async () => {
    const check = vi
      .spyOn(fakeBrowser.extension, "isAllowedIncognitoAccess")
      .mockImplementation(async () => true);

    await expect(isIncognitoAllowed()).resolves.toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("reports no access when the browser denies it", async () => {
    vi.spyOn(
      fakeBrowser.extension,
      "isAllowedIncognitoAccess",
    ).mockImplementation(async () => false);

    await expect(isIncognitoAllowed()).resolves.toBe(false);
  });

  it("treats a rejected access check as no access", async () => {
    vi.spyOn(
      fakeBrowser.extension,
      "isAllowedIncognitoAccess",
    ).mockRejectedValue(new Error("incognito access denied"));

    await expect(isIncognitoAllowed()).resolves.toBe(false);
  });

  it("treats a browser without the access check as no access", async () => {
    const extension = fakeBrowser.extension;
    Object.defineProperty(fakeBrowser, "extension", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    try {
      await expect(isIncognitoAllowed()).resolves.toBe(false);
    } finally {
      Object.defineProperty(fakeBrowser, "extension", {
        configurable: true,
        writable: true,
        value: extension,
      });
    }
  });

  it("exposes the extensions page as a copyable path", () => {
    expect(EXTENSIONS_PAGE_PATH).toMatch(/^(chrome|about):/);
  });
});
