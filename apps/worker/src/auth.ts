/**
 * Framework-free auth helpers shared by the Worker routes.
 *
 * The client stores `SHA-256 hex` of the base64url bearer string
 * (`hashAuthKey` in packages/shared/src/crypto/key.ts); the server recomputes
 * the same digest and compares it in constant time.
 */

const textEncoder = new TextEncoder();
const HEX_DIGITS = "0123456789abcdef";

/** Lowercase SHA-256 hex digest of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", textEncoder.encode(input)),
  );

  let hex = "";
  for (const byte of digest) {
    hex += HEX_DIGITS[byte >> 4];
    hex += HEX_DIGITS[byte & 0x0f];
  }
  return hex;
}

/**
 * Compare two strings without an early exit on the first differing byte.
 *
 * The loop always runs for the longer input, so the number of comparisons
 * only depends on the input length (the two stored SHA-256 hashes have equal
 * length, which is the security-relevant case).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);

  let difference = aBytes.length ^ bBytes.length;
  const length = Math.max(aBytes.length, bBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (aBytes[index] ?? 0) ^ (bBytes[index] ?? 0);
  }
  return difference === 0;
}

/** Parse `Authorization: Bearer <token>`; anything else is malformed. */
export function parseBearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
