import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useI18n } from "./useI18n";

beforeEach(() => {
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

afterEach(() => {
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

describe("useI18n", () => {
  it("sets the document direction to right-to-left for Arabic", () => {
    const { result } = renderHook(() => useI18n("ar"));

    expect(result.current.lang).toBe("ar");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("keeps left-to-right for left-to-right languages", () => {
    renderHook(() => useI18n("ja"));

    expect(document.documentElement.lang).toBe("ja");
    expect(document.documentElement.dir).toBe("ltr");
  });
});
