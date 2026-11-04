import { describe, it, expect } from "vitest";
import { LIMITS, APP_NAME } from "./constants";

describe("constants", () => {
  it("pins sync limits", () => {
    expect(LIMITS.maxSessionBytes).toBe(262144);
    expect(LIMITS.maxTabsPerSession).toBe(500);
    expect(LIMITS.maxSessionsPerKey).toBe(200);
    expect(LIMITS.maxKeyBytes).toBe(5 * 1024 * 1024);
    expect(LIMITS.maxLocalSessions).toBe(500);
    expect(LIMITS.maxLocalTabs).toBe(15000);
    expect(APP_NAME).toBe("SaveTabs");
  });
});
