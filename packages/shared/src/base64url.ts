/**
 * Unpadded base64url (RFC 4648 §5) helpers used for auth ids, bearer keys and
 * encrypted session blobs.
 *
 * Implemented in plain TypeScript (no Buffer, no atob/btoa) so the same code
 * runs in extension pages, browser tabs and Cloudflare Workers.
 */

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const BASE64_VALUES = new Map<string, number>(
  Array.from(BASE64_ALPHABET, (char, index) => [char, index] as const),
);

/** Encode bytes as unpadded URL-safe base64. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const byte0 = bytes[i];
    const byte1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const byte2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const chunk = (byte0 << 16) | (byte1 << 8) | byte2;
    out += BASE64_ALPHABET[(chunk >> 18) & 63];
    out += BASE64_ALPHABET[(chunk >> 12) & 63];
    if (i + 1 < bytes.length) out += BASE64_ALPHABET[(chunk >> 6) & 63];
    if (i + 2 < bytes.length) out += BASE64_ALPHABET[chunk & 63];
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Decode base64url or standard base64. Padding is optional; whitespace around
 * the value is ignored.
 */
export function fromBase64Url(value: string): Uint8Array {
  const normalized = value
    .trim()
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/=+$/, "");

  if (normalized.length % 4 === 1) {
    throw new Error("Invalid base64url string: bad length");
  }

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of normalized) {
    const digit = BASE64_VALUES.get(char);
    if (digit === undefined) {
      throw new Error(`Invalid base64url character: ${char}`);
    }
    buffer = ((buffer << 6) | digit) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}
