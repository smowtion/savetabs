import { fromBase64Url, toBase64Url } from "../base64url";

/**
 * Password-based key derivation for optional E2EE accounts.
 *
 * The password is stretched with PBKDF2-SHA256 into a 32-byte master key that
 * never leaves the device. Two independent values are derived from it:
 * - an authentication proof (HMAC-SHA256) sent to the worker, which stores
 *   only its SHA-256, and
 * - a non-extractable AES-GCM wrapping key (HKDF-SHA256) that encrypts the
 *   existing sync key in the account vault.
 *
 * WebCrypto only, so this runs in extension pages, the web app and Workers.
 */

/** OWASP-recommended PBKDF2-SHA256 work factor for password storage. */
export const KDF_ITERATIONS = 600_000;

/** An email-derived 128-bit salt makes rainbow tables per account useless. */
export const KDF_SALT_BYTES = 16;

const MASTER_KEY_BYTES = 32;
const AUTH_PROOF_MESSAGE = "savetabs-auth-v1";
const KDF_SALT_DOMAIN = "savetabs-kdf-v1";
const HKDF_SALT = new TextEncoder().encode("savetabs-v1");
const HKDF_INFO = new TextEncoder().encode("vault-wrap");
const AES_GCM_KEY_ALGORITHM = { name: "AES-GCM", length: 256 } as const;

const textEncoder = new TextEncoder();

/**
 * Derive the KDF salt for an account from its email.
 *
 * Signup and every later login must stretch the password with the same salt,
 * but the server cannot return the salt before the client authenticates and a
 * "prepare login" endpoint would reveal which emails have accounts. Deriving
 * the salt from the normalized email (trimmed and lowercased, matching the
 * worker) gives every device the same value without a server round trip. The
 * domain prefix keeps the digest from doubling as an email hash elsewhere.
 */
export async function deriveKdfSalt(email: string): Promise<Uint8Array> {
  const normalized = email.trim().toLowerCase();
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      textEncoder.encode(`${KDF_SALT_DOMAIN}:${normalized}`),
    ),
  );
  return digest.slice(0, KDF_SALT_BYTES);
}

/** Encode a salt for storage in the account profile. */
export function encodeSalt(raw: Uint8Array): string {
  return toBase64Url(raw);
}

/** Decode a salt received from the account profile. */
export function decodeSalt(value: string): Uint8Array {
  return fromBase64Url(value);
}

function assertMasterKeyLength(masterKey: Uint8Array): void {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error(
      `Master key must be ${MASTER_KEY_BYTES} bytes, got ${masterKey.length}`,
    );
  }
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Stretch the password with PBKDF2-SHA256. `iterations` is injectable so tests
 * can use a cheap work factor; production callers rely on the default.
 */
export async function deriveMasterKey(
  password: string,
  salt: Uint8Array,
  iterations: number = KDF_ITERATIONS,
): Promise<Uint8Array> {
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      // Copy into a fresh view: WebCrypto's BufferSource typing requires an
      // ArrayBuffer-backed array, while callers may pass any Uint8Array view.
      salt: new Uint8Array(salt),
      iterations,
    },
    baseKey,
    256,
  );
  return new Uint8Array(bits);
}

/** Derive the lowercase-hex authentication proof sent to the worker. */
export async function deriveAuthHash(
  masterKey: Uint8Array,
): Promise<string> {
  assertMasterKeyLength(masterKey);
  const hmacKey = await globalThis.crypto.subtle.importKey(
    "raw",
    new Uint8Array(masterKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await globalThis.crypto.subtle.sign(
      "HMAC",
      hmacKey,
      textEncoder.encode(AUTH_PROOF_MESSAGE),
    ),
  );
  return toHex(signature);
}

/** Derive the non-extractable AES-GCM key that wraps the sync key. */
export async function deriveWrapKey(masterKey: Uint8Array): Promise<CryptoKey> {
  assertMasterKeyLength(masterKey);
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    new Uint8Array(masterKey),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HKDF_INFO },
    baseKey,
    AES_GCM_KEY_ALGORITHM,
    false,
    ["encrypt", "decrypt"],
  );
}
