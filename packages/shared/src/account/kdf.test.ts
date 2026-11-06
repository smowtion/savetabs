import { describe, expect, it } from "vitest";
import {
  KDF_ITERATIONS,
  KDF_SALT_BYTES,
  decodeSalt,
  deriveAuthHash,
  deriveKdfSalt,
  deriveMasterKey,
  deriveWrapKey,
  encodeSalt,
} from "./kdf";

const PASSWORD = "correct horse battery staple";
const SALT = Uint8Array.from({ length: 16 }, (_, i) => i);

describe("account KDF", () => {
  it("stretches the password with PBKDF2-SHA256", async () => {
    const masterKey = await deriveMasterKey(PASSWORD, SALT, 1000);
    expect(Buffer.from(masterKey).toString("hex")).toBe(
      "a69b179e3add3c1e0aaf227a0eb3aa2aa8645ab86fecf6ca00c17512697c719e",
    );
  });

  it("defaults to the production iteration count", async () => {
    const explicit = await deriveMasterKey(PASSWORD, SALT, KDF_ITERATIONS);
    const implicit = await deriveMasterKey(PASSWORD, SALT);
    expect(implicit).toEqual(explicit);
    expect(KDF_ITERATIONS).toBe(600000);
  });

  it("derives the authentication proof", async () => {
    const masterKey = Uint8Array.from({ length: 32 }, (_, i) => i);
    expect(await deriveAuthHash(masterKey)).toBe(
      "e07b4f63abd5a633d8a3f4346b8f99642025b577ac400d2f19240aad665b7599",
    );
  });

  it("derives a stable 16-byte salt from the email", async () => {
    expect(KDF_SALT_BYTES).toBe(16);
    const salt = await deriveKdfSalt("a@example.com");
    expect(salt).toHaveLength(KDF_SALT_BYTES);
    expect(Buffer.from(salt).toString("hex")).toBe(
      "7f0cca4000f447765d3403d40aeff812",
    );
  });

  it("normalizes case and surrounding whitespace before hashing", async () => {
    const salt = await deriveKdfSalt("a@example.com");
    expect(await deriveKdfSalt("  A@Example.COM  ")).toEqual(salt);
    expect(await deriveKdfSalt("A@EXAMPLE.COM")).toEqual(salt);
  });

  it("derives different salts for different emails", async () => {
    const first = await deriveKdfSalt("a@example.com");
    const second = await deriveKdfSalt("b@example.com");
    expect(first).not.toEqual(second);
  });

  it("round-trips the salt through its base64url form", () => {
    const encoded = encodeSalt(SALT);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSalt(encoded)).toEqual(SALT);
  });

  it("derives a non-extractable AES-GCM wrap key", async () => {
    const wrapKey = await deriveWrapKey(new Uint8Array(32).fill(7));
    expect(wrapKey.extractable).toBe(false);
    expect(wrapKey.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect([...wrapKey.usages].sort()).toEqual(["decrypt", "encrypt"]);
  });
});
