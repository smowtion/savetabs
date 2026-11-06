import { LANGS } from "@savetabs/shared";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { LANGUAGE_STORAGE_KEY, useI18n } from "./useI18n";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

describe("useI18n", () => {
  it("restores any supported language stored on this device", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "ja");

    const { result } = renderHook(() => useI18n());

    expect(result.current.lang).toBe("ja");
  });

  it("ignores unsupported stored values and follows the browser", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "th");

    const { result } = renderHook(() => useI18n());

    expect(LANGS).toContain(result.current.lang);
  });

  it("sets the document language and direction from the selection", () => {
    const { result } = renderHook(() => useI18n());

    act(() => result.current.setLang("ar"));

    expect(result.current.lang).toBe("ar");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ar");
  });

  it("returns to left-to-right when a left-to-right language is chosen", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "ar");
    const { result } = renderHook(() => useI18n());
    expect(document.documentElement.dir).toBe("rtl");

    act(() => result.current.setLang("de"));

    expect(result.current.lang).toBe("de");
    expect(document.documentElement.dir).toBe("ltr");
  });
});
