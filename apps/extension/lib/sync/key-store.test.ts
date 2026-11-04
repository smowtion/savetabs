import { formatKey, parseKey } from "@savetabs/shared";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SYNC_KEY_REBIND_STORAGE_KEY,
  SYNC_KEY_STORAGE_KEY,
  consumePendingRebind,
  getKey,
  getOrCreateKey,
  peekPendingRebind,
  rotateKey,
  setKey,
} from "./key-store";

/** A valid key whose letters and dashes are deliberately non-canonical. */
const LOOSE_KEY = "st-abcde-fghjk-mnpqr-stvwx-yz012-34567";
const NORMALIZED_LOOSE_KEY = formatKey(parseKey(LOOSE_KEY));

async function storage(): Promise<Record<string, unknown>> {
  return (await fakeBrowser.storage.local.get(null)) as Record<string, unknown>;
}

async function storedKey(): Promise<unknown> {
  return (await storage())[SYNC_KEY_STORAGE_KEY];
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  fakeBrowser.reset();
});

describe("getOrCreateKey", () => {
  it("creates a valid key once and reuses it afterwards", async () => {
    const first = await getOrCreateKey();

    expect(first).toMatch(/^ST(-[0-9A-HJKMNP-TV-Z]{5}){5}-[0-9A-HJKMNP-TV-Z]$/);
    expect(parseKey(first)).toHaveLength(16);
    await expect(storedKey()).resolves.toBe(first);

    const second = await getOrCreateKey();

    expect(second).toBe(first);
    await expect(storedKey()).resolves.toBe(first);
  });

  it("replaces an invalid stored key with a fresh valid one", async () => {
    await fakeBrowser.storage.local.set({ [SYNC_KEY_STORAGE_KEY]: "not-a-key" });

    const key = await getOrCreateKey();

    expect(() => parseKey(key)).not.toThrow();
    expect(key).not.toBe("not-a-key");
    await expect(storedKey()).resolves.toBe(key);
  });

  it("normalizes a valid but unformatted stored key", async () => {
    await fakeBrowser.storage.local.set({ [SYNC_KEY_STORAGE_KEY]: LOOSE_KEY });

    const key = await getOrCreateKey();

    expect(key).toBe(NORMALIZED_LOOSE_KEY);
    await expect(storedKey()).resolves.toBe(NORMALIZED_LOOSE_KEY);
  });

  it("does not schedule a rebind when it creates the first key", async () => {
    await getOrCreateKey();

    const stored = await storage();
    expect(stored).not.toHaveProperty(SYNC_KEY_REBIND_STORAGE_KEY);
  });
});

describe("getKey", () => {
  it("returns undefined when no key is stored", async () => {
    await expect(getKey()).resolves.toBeUndefined();
  });

  it("returns the stored key in canonical form", async () => {
    await fakeBrowser.storage.local.set({ [SYNC_KEY_STORAGE_KEY]: LOOSE_KEY });

    await expect(getKey()).resolves.toBe(NORMALIZED_LOOSE_KEY);
  });

  it("returns undefined for an invalid stored key", async () => {
    await fakeBrowser.storage.local.set({ [SYNC_KEY_STORAGE_KEY]: "garbage" });

    await expect(getKey()).resolves.toBeUndefined();
  });
});

describe("setKey", () => {
  it("validates, normalizes and stores the key with a pending upload", async () => {
    const normalized = await setKey(LOOSE_KEY);

    expect(normalized).toBe(NORMALIZED_LOOSE_KEY);
    const stored = await storage();
    expect(stored[SYNC_KEY_STORAGE_KEY]).toBe(NORMALIZED_LOOSE_KEY);
    expect(stored[SYNC_KEY_REBIND_STORAGE_KEY]).toBe("upload");
  });

  it("rejects an invalid key without touching storage", async () => {
    const original = await getOrCreateKey();

    await expect(setKey("ST-123")).rejects.toThrow("InvalidKeyError");

    const stored = await storage();
    expect(stored[SYNC_KEY_STORAGE_KEY]).toBe(original);
    expect(stored).not.toHaveProperty(SYNC_KEY_REBIND_STORAGE_KEY);
  });

  it("stores an explicit skip decision for imported keys", async () => {
    await setKey(LOOSE_KEY, "skip");

    const stored = await storage();
    expect(stored[SYNC_KEY_REBIND_STORAGE_KEY]).toBe("skip");
  });
});

describe("rotateKey", () => {
  it("creates a different key and schedules an upload", async () => {
    const previous = await getOrCreateKey();

    const rotated = await rotateKey();

    expect(rotated).not.toBe(previous);
    expect(() => parseKey(rotated)).not.toThrow();
    const stored = await storage();
    expect(stored[SYNC_KEY_STORAGE_KEY]).toBe(rotated);
    expect(stored[SYNC_KEY_REBIND_STORAGE_KEY]).toBe("upload");
  });
});

describe("peekPendingRebind", () => {
  it("reads a decision without consuming it", async () => {
    await setKey(LOOSE_KEY, "skip");

    await expect(peekPendingRebind()).resolves.toBe("skip");
    await expect(peekPendingRebind()).resolves.toBe("skip");
    // The marker is still there for the consumer.
    await expect(consumePendingRebind()).resolves.toBe("skip");
    await expect(peekPendingRebind()).resolves.toBeUndefined();
  });

  it("returns undefined for an absent or unknown decision", async () => {
    await expect(peekPendingRebind()).resolves.toBeUndefined();

    await fakeBrowser.storage.local.set({
      [SYNC_KEY_REBIND_STORAGE_KEY]: "later",
    });
    await expect(peekPendingRebind()).resolves.toBeUndefined();
    // Peeking never clears a malformed value either.
    expect(await storage()).toHaveProperty(SYNC_KEY_REBIND_STORAGE_KEY);
  });
});

describe("consumePendingRebind", () => {
  it("returns and clears an upload decision", async () => {
    await setKey(LOOSE_KEY);

    await expect(consumePendingRebind()).resolves.toBe("upload");
    await expect(consumePendingRebind()).resolves.toBeUndefined();
    expect(await storage()).not.toHaveProperty(SYNC_KEY_REBIND_STORAGE_KEY);
  });

  it("returns and clears a skip decision", async () => {
    await setKey(LOOSE_KEY, "skip");

    await expect(consumePendingRebind()).resolves.toBe("skip");
    expect(await storage()).not.toHaveProperty(SYNC_KEY_REBIND_STORAGE_KEY);
  });

  it("returns undefined when no decision is pending", async () => {
    await expect(consumePendingRebind()).resolves.toBeUndefined();
  });

  it("clears an unknown decision and ignores it", async () => {
    await fakeBrowser.storage.local.set({
      [SYNC_KEY_REBIND_STORAGE_KEY]: "retry",
    });

    await expect(consumePendingRebind()).resolves.toBeUndefined();
    expect(await storage()).not.toHaveProperty(SYNC_KEY_REBIND_STORAGE_KEY);
  });
});
