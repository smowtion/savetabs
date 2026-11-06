import { fromBase64Url, toBase64Url } from "../base64url";

/**
 * Account vault: the existing sync key encrypted under the password-derived
 * wrapping key.
 *
 * The worker stores only the ciphertext. A fresh random 12-byte IV is used for
 * every wrap, and the additional authenticated data binds the vault to one
 * key (`savetabs:vault:v1:<authId>`), so a server cannot move a wrapped
 * key to another account without failing authentication.
 *
 * WebCrypto only, so this runs in extension pages, the web app and Workers.
 */

/** AES-GCM uses a 96-bit IV; longer or shorter IVs weaken or break it. */
const IV_BYTES = 12;
const AAD_DOMAIN = "savetabs:vault:v1";

const textEncoder = new TextEncoder();

/** AAD ties the wrapped key to the account it was created for. */
function buildAdditionalData(accountId: string) {
  // No explicit `Uint8Array` return type: the bare default is backed by
  // `ArrayBufferLike`, which WebCrypto's BufferSource does not accept.
  return textEncoder.encode(`${AAD_DOMAIN}:${accountId}`);
}

/** Encrypt the sync key; returns base64url(IV || ciphertext). */
export async function wrapSyncKey(
  wrapKey: CryptoKey,
  rawKey: Uint8Array,
  accountId: string,
): Promise<string> {
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(iv);

  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: buildAdditionalData(accountId),
      },
      wrapKey,
      new Uint8Array(rawKey),
    ),
  );

  const blob = new Uint8Array(IV_BYTES + ciphertext.length);
  blob.set(iv, 0);
  blob.set(ciphertext, IV_BYTES);
  return toBase64Url(blob);
}

/**
 * Decrypt the sync key. `accountId` is passed explicitly (never read from the
 * blob) so the AAD binding is checked before any key material is trusted.
 * Throws when the blob is too short, when the AAD does not match, or when the
 * GCM tag does not authenticate the ciphertext.
 */
export async function unwrapSyncKey(
  wrapKey: CryptoKey,
  wrapped: string,
  accountId: string,
): Promise<Uint8Array> {
  const bytes = fromBase64Url(wrapped);
  if (bytes.length <= IV_BYTES) {
    throw new Error(
      `Invalid vault blob: ${bytes.length} bytes is not longer than the ${IV_BYTES}-byte IV`,
    );
  }

  const iv = bytes.slice(0, IV_BYTES);
  const ciphertext = bytes.slice(IV_BYTES);

  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: buildAdditionalData(accountId),
        },
        wrapKey,
        ciphertext,
      ),
    );
  } catch {
    throw new Error(
      "Invalid vault blob: decryption failed (wrong key, account or ciphertext)",
    );
  }
  return plaintext;
}
