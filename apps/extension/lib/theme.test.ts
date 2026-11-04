import { describe, expect, it } from "vitest";

import { nextThemePreference, resolveTheme } from "./theme";

describe("theme", () => {
  it("follows the system media query for the system preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("honors explicit light and dark preferences", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("falls back to the system preference for invalid values", () => {
    expect(resolveTheme(undefined, true)).toBe("dark");
    expect(resolveTheme("neon", false)).toBe("light");
  });

  it("cycles system -> light -> dark -> system", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
    expect(nextThemePreference(undefined)).toBe("light");
  });
});
