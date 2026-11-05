import { describe, expect, it } from "vitest";
import { deriveWrapKey } from "./kdf";
import { unwrapSyncKey, wrapSyncKey } from "./vault";

describe("sync key vault", () => {
  it("round-trips the sync key", async () => {
    const masterKey = new Uint8Array(32).fill(7);
    const wrapKey = await deriveWrapKey(masterKey);
    const rawKey = new Uint8Array(16).fill(3);
    const wrapped = await wrapSyncKey(wrapKey, rawKey, "acc-1");
    expect(await unwrapSyncKey(wrapKey, wrapped, "acc-1")).toEqual(rawKey);
  });

  it("rejects a different account AAD", async () => {
    const wrapKey = await deriveWrapKey(new Uint8Array(32).fill(7));
    const wrapped = await wrapSyncKey(wrapKey, new Uint8Array(16), "acc-1");
    await expect(unwrapSyncKey(wrapKey, wrapped, "acc-2")).rejects.toThrow();
  });

  it("uses a fresh IV for every wrap", async () => {
    const wrapKey = await deriveWrapKey(new Uint8Array(32).fill(7));
    const rawKey = new Uint8Array(16).fill(3);
    const first = await wrapSyncKey(wrapKey, rawKey, "acc-1");
    const second = await wrapSyncKey(wrapKey, rawKey, "acc-1");
    expect(first).not.toBe(second);
    expect(await unwrapSyncKey(wrapKey, second, "acc-1")).toEqual(rawKey);
  });
});
