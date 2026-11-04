import {
  InvalidKeyError,
  deriveKeys,
  formatKey,
  parseKey,
} from "@savetabs/shared";
import { beforeEach, describe, expect, it } from "vitest";

import {
  KEY_STORAGE_KEY,
  clearKey,
  deriveForWeb,
  loadKey,
  saveKeyForSession,
} from "./key-session";

/** A syntactically valid key: ST- prefix plus 26 Crockford symbols. */
const VALID_KEY = "ST-00000-00000-00000-00000-00000-0";
const OTHER_KEY = formatKey(new Uint8Array(16).fill(7));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("key session storage", () => {
  it("stores the canonical key in sessionStorage by default", () => {
    saveKeyForSession("st-00000-00000-00000-00000-00000-0");

    expect(sessionStorage.getItem(KEY_STORAGE_KEY)).toBe(VALID_KEY);
    expect(localStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
    expect(loadKey()).toBe(VALID_KEY);
  });

  it("rejects an invalid key without writing anything", () => {
    expect(() => saveKeyForSession("not-a-key")).toThrow(InvalidKeyError);

    expect(sessionStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
    expect(loadKey()).toBeNull();
  });

  it("persists a remembered key to localStorage", () => {
    saveKeyForSession(VALID_KEY, true);

    expect(localStorage.getItem(KEY_STORAGE_KEY)).toBe(VALID_KEY);
    expect(sessionStorage.getItem(KEY_STORAGE_KEY)).toBe(VALID_KEY);
  });

  it("drops the remembered copy when remembering is unchecked", () => {
    saveKeyForSession(VALID_KEY, true);
    saveKeyForSession(VALID_KEY, false);

    expect(localStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY_STORAGE_KEY)).toBe(VALID_KEY);
  });

  it("prefers a remembered key over the session copy when loading", () => {
    sessionStorage.setItem(KEY_STORAGE_KEY, VALID_KEY);
    localStorage.setItem(KEY_STORAGE_KEY, OTHER_KEY);

    expect(loadKey()).toBe(OTHER_KEY);
  });

  it("discards corrupted stored values instead of returning them", () => {
    localStorage.setItem(KEY_STORAGE_KEY, "garbage");
    sessionStorage.setItem(KEY_STORAGE_KEY, "more-garbage");

    expect(loadKey()).toBeNull();
    expect(localStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
  });

  it("clears both storage locations", () => {
    saveKeyForSession(VALID_KEY, true);

    clearKey();

    expect(localStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
    expect(loadKey()).toBeNull();
  });

  it("never writes the key into the URL", () => {
    saveKeyForSession(VALID_KEY, true);

    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(VALID_KEY);
  });
});

describe("deriveForWeb", () => {
  it("derives the same material as the shared crypto helpers", async () => {
    const derived = await deriveForWeb(VALID_KEY);
    const expected = await deriveKeys(parseKey(VALID_KEY));

    expect(derived.authId).toBe(expected.authId);
    expect(derived.authKey).toBe(expected.authKey);
    expect(derived.encKey.algorithm).toMatchObject({
      name: "AES-GCM",
      length: 256,
    });
    expect(derived.encKey.extractable).toBe(false);
  });

  it("rejects an invalid key", async () => {
    await expect(deriveForWeb("not-a-key")).rejects.toBeInstanceOf(
      InvalidKeyError,
    );
  });
});
