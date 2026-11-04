import { describe, it, expect } from "vitest";
import { generateKey, parseKey, formatKey, deriveKeys, hashAuthKey } from "./key";

it("generates a parsable 128-bit key", () => {
  const key = generateKey();
  expect(key).toMatch(/^ST(-[0-9A-HJKMNP-TV-Z]{5}){5}-[0-9A-HJKMNP-TV-Z]$/);
  expect(parseKey(key)).toHaveLength(16);
});
it("round-trips and forgives case/dashes", () => {
  const raw = parseKey("st-abcde-fghjk-mnpqr-stvwx-yz012-34567");
  expect(parseKey(formatKey(raw))).toEqual(raw);
});
it("derives deterministic independent values", async () => {
  const raw = parseKey(generateKey());
  const a = await deriveKeys(raw), b = await deriveKeys(raw);
  expect(a.authId).toBe(b.authId);
  expect(a.authKey).toBe(b.authKey);
  expect(a.authId).toHaveLength(22);
  expect(await hashAuthKey(a.authKey)).toMatch(/^[0-9a-f]{64}$/);
});
it("rejects malformed keys", () => {
  expect(() => parseKey("ST-123")).toThrow("InvalidKeyError");
});
