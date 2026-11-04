import { describe, it, expect } from "vitest";
import { deriveKeys, generateKey, parseKey } from "./key";
import { decryptSession, encryptSession } from "./session-cipher";

const session = {
  id: "11111111-1111-4111-8111-111111111111", createdAt: 1, updatedAt: 2,
  source: "window" as const, tabs: [{ url: "https://example.com/a", title: "A" }],
};
it("round-trips", async () => {
  const { encKey, authId } = await deriveKeys(parseKey(generateKey()));
  const blob = await encryptSession(encKey, authId, session);
  await expect(decryptSession(encKey, authId, session.id, blob)).resolves.toEqual(session);
});
it("fails on wrong AAD and tampering", async () => {
  const { encKey, authId } = await deriveKeys(parseKey(generateKey()));
  const blob = await encryptSession(encKey, authId, session);
  await expect(decryptSession(encKey, "other", session.id, blob)).rejects.toThrow();
  const bytes = Buffer.from(blob, "base64url");
  bytes[bytes.length - 1] ^= 1;
  await expect(decryptSession(encKey, authId, session.id, bytes.toString("base64url"))).rejects.toThrow();
});
