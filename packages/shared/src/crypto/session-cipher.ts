import { fromBase64Url, toBase64Url } from "../base64url";
import type { Session } from "../types";

/**
 * Authenticated encryption for synced sessions.
 *
 * Each session is encrypted with AES-GCM 256 under the non-extractable encKey.
 * The blob stored on the sync server is base64url(IV || ciphertext); the server
 * never sees the URL/title plaintext. A fresh random 12-byte IV is generated
 * for every encryption, so the same session may be re-uploaded safely.
 *
 * The additional authenticated data binds a blob to one identity and one
 * session id (`savetabs:v1:<authId>:<sessionId>`), so a server cannot move a
 * blob to another session or replay it under another key without failing
 * authentication.
 *
 * WebCrypto only, so this runs in extension pages, the web app and Workers.
 */

/** AES-GCM uses a 96-bit IV; longer or shorter IVs weaken or break it. */
const IV_BYTES = 12;
const AAD_DOMAIN = "savetabs:v1";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** AAD ties ciphertext to the account (authId) and the session id. */
function buildAdditionalData(authId: string, sessionId: string) {
  // No explicit `Uint8Array` return type: the bare default is backed by
  // `ArrayBufferLike`, which WebCrypto's BufferSource does not accept.
  return textEncoder.encode(`${AAD_DOMAIN}:${authId}:${sessionId}`);
}

/** Encrypt one session; returns base64url(IV || ciphertext). */
export async function encryptSession(
  encKey: CryptoKey,
  authId: string,
  session: Session,
): Promise<string> {
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(iv);
  const plaintext = textEncoder.encode(JSON.stringify(session));

  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: buildAdditionalData(authId, session.id),
      },
      encKey,
      plaintext,
    ),
  );

  const blob = new Uint8Array(IV_BYTES + ciphertext.length);
  blob.set(iv, 0);
  blob.set(ciphertext, IV_BYTES);
  return toBase64Url(blob);
}

/**
 * Decrypt one session blob. `sessionId` is passed explicitly (never read from
 * the blob) so the AAD binding is checked before any plaintext is trusted.
 * Throws when the blob is too short, when the AAD does not match, or when the
 * GCM tag does not authenticate the ciphertext.
 */
export async function decryptSession(
  encKey: CryptoKey,
  authId: string,
  sessionId: string,
  blob: string,
): Promise<Session> {
  const bytes = fromBase64Url(blob);
  if (bytes.length < IV_BYTES) {
    throw new Error(
      `Invalid session blob: ${bytes.length} bytes is shorter than the ${IV_BYTES}-byte IV`,
    );
  }

  const iv = bytes.slice(0, IV_BYTES);
  const ciphertext = bytes.slice(IV_BYTES);

  const plaintext = new Uint8Array(
    await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: buildAdditionalData(authId, sessionId),
      },
      encKey,
      ciphertext,
    ),
  );

  return JSON.parse(textDecoder.decode(plaintext)) as Session;
}
