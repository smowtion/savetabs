import { toBase64Url } from "../base64url";

/**
 * SaveTabs key format and derivation.
 *
 * A user key is 128 random bits shown as Crockford Base32 with an `ST-` prefix
 * in groups of five (`ST-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-X`). The 26 data symbols
 * carry 130 bits; the last two are zero padding and are ignored when parsing.
 * Parsing also accepts longer legacy keys, lower case, dashes anywhere and the
 * ambiguous Crockford characters I/L (→1) and O (→0).
 *
 * All primitives come from WebCrypto so the same module runs in the extension,
 * the web app and Cloudflare Workers.
 */

const KEY_BYTES = 16;
const KEY_SYMBOLS = 26;
const KEY_PREFIX = "ST-";
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const CROCKFORD_VALUES = new Map<string, number>(
  Array.from(CROCKFORD_ALPHABET, (char, index) => [char, index] as const),
);

const textEncoder = new TextEncoder();
const HKDF_SALT = textEncoder.encode("savetabs-v1");
const AES_GCM_KEY_ALGORITHM = { name: "AES-GCM", length: 256 } as const;

/** Thrown when a user-entered or raw key cannot be parsed. */
export class InvalidKeyError extends Error {
  constructor(reason: string) {
    super(`InvalidKeyError: ${reason}`);
    this.name = "InvalidKeyError";
  }
}

/** Keys derived from the raw 128-bit user key. */
export interface DerivedKeys {
  /** Public server-side identifier (128 bits, base64url). */
  authId: string;
  /** Bearer secret sent to the sync server (256 bits, base64url). */
  authKey: string;
  /** Non-extractable AES-GCM 256 key; never leaves the client. */
  encKey: CryptoKey;
}

function normalizeKeyBody(input: string): string {
  const compact = input.trim().toUpperCase().replace(/-/g, "");
  if (!compact.startsWith("ST")) {
    throw new InvalidKeyError("missing ST prefix");
  }
  return compact
    .slice(2)
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

/** Generate a new random 128-bit key in display format. */
export function generateKey(): string {
  const raw = new Uint8Array(KEY_BYTES);
  globalThis.crypto.getRandomValues(raw);
  return formatKey(raw);
}

/** Parse a user-entered key into its 16 raw bytes. */
export function parseKey(input: string): Uint8Array {
  const body = normalizeKeyBody(input);
  if (body.length < KEY_SYMBOLS) {
    throw new InvalidKeyError(
      `expected at least ${KEY_SYMBOLS} characters, got ${body.length}`,
    );
  }

  const bytes = new Uint8Array(KEY_BYTES);
  let byteIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (const char of body) {
    const digit = CROCKFORD_VALUES.get(char);
    if (digit === undefined) {
      throw new InvalidKeyError(`unexpected character "${char}"`);
    }
    buffer = ((buffer << 5) | digit) & 0x1fff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      if (byteIndex < KEY_BYTES) {
        bytes[byteIndex++] = (buffer >> bits) & 0xff;
      }
    }
  }
  return bytes;
}

/** Format 16 raw bytes as a display key. */
export function formatKey(raw: Uint8Array): string {
  if (raw.length !== KEY_BYTES) {
    throw new InvalidKeyError(`raw key must be ${KEY_BYTES} bytes`);
  }

  let symbols = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of raw) {
    buffer = ((buffer << 8) | byte) & 0x1fff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      symbols += CROCKFORD_ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) {
    symbols += CROCKFORD_ALPHABET[(buffer << (5 - bits)) & 31];
  }

  const groups = symbols.match(/.{1,5}/g) ?? [symbols];
  return `${KEY_PREFIX}${groups.join("-")}`;
}

function hkdfParams(info: string): HkdfParams {
  return {
    name: "HKDF",
    hash: "SHA-256",
    salt: HKDF_SALT,
    info: textEncoder.encode(info),
  };
}

/**
 * Derive the public auth id, the bearer auth key and the AES-GCM content key
 * from a raw 128-bit key. HKDF-SHA256 keeps the three outputs independent:
 * leaking one reveals nothing about the key or the others.
 */
export async function deriveKeys(rawKey: Uint8Array): Promise<DerivedKeys> {
  if (rawKey.length !== KEY_BYTES) {
    throw new InvalidKeyError(`raw key must be ${KEY_BYTES} bytes`);
  }

  const subtle = globalThis.crypto.subtle;
  // Copy into a fresh view: WebCrypto's BufferSource typing requires an
  // ArrayBuffer-backed array, while callers may pass any Uint8Array view.
  const keyData = new Uint8Array(rawKey);
  const baseKey = await subtle.importKey("raw", keyData, "HKDF", false, [
    "deriveBits",
    "deriveKey",
  ]);
  const authIdBits = await subtle.deriveBits(
    hkdfParams("auth-id"),
    baseKey,
    128,
  );
  const authKeyBits = await subtle.deriveBits(
    hkdfParams("auth-key"),
    baseKey,
    256,
  );
  const encKey = await subtle.deriveKey(
    hkdfParams("enc-key"),
    baseKey,
    AES_GCM_KEY_ALGORITHM,
    false,
    ["encrypt", "decrypt"],
  );

  return {
    authId: toBase64Url(new Uint8Array(authIdBits)),
    authKey: toBase64Url(new Uint8Array(authKeyBits)),
    encKey,
  };
}

/** SHA-256 hex of the bearer auth key string, as stored by the sync server. */
export async function hashAuthKey(authKey: string): Promise<string> {
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      textEncoder.encode(authKey),
    ),
  );

  let hex = "";
  for (const byte of digest) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
