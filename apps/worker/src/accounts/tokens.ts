/**
 * Account token primitives.
 *
 * Account bearers are 32 random bytes encoded as unpadded base64url and are
 * stored only as their lowercase SHA-256 hex digest, mirroring the sync keys.
 */

import { toBase64Url } from "@savetabs/shared/base64url";
import { sha256Hex } from "../auth";

/** 256 bits of entropy keeps guessing a bearer token infeasible. */
const TOKEN_BYTES = 32;

/** Lowercase and trim an address so storage and lookups agree on one form. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Create a bearer token and the digest the database stores for it. */
export async function createToken(): Promise<{
  token: string;
  tokenHash: string;
}> {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);

  const token = toBase64Url(bytes);
  return { token, tokenHash: await sha256Hex(token) };
}

/** SHA-256 hex digest stored in `account_tokens` and `email_verifications`. */
export function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}
