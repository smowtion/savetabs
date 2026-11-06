/**
 * Password-based account sign-in and recovery flows for the web app.
 *
 * Keeping the derivations here means the pages only own form state and error
 * copy. The rules are shared with signup:
 * - the KDF salt is derived from the normalized email, so every device derives
 *   the same master key without a server round trip before authentication;
 * - the vault is bound to the sync key's `authId`, which the login response
 *   returns and recovery can derive from the recovery key;
 * - the sync key is stored with the caller's remember choice.
 *
 * An account with no vault yet gets a freshly generated key, wrapped and
 * linked with the key-derived bearer, and the recovery key is returned so the
 * page can show its required acknowledgement dialog.
 */

import {
  KDF_ITERATIONS,
  deriveAuthHash,
  deriveKdfSalt,
  deriveKeys,
  deriveMasterKey,
  deriveWrapKey,
  encodeSalt,
  formatKey,
  generateKey,
  parseKey,
  unwrapSyncKey,
  wrapSyncKey,
} from "@savetabs/shared";

import { createAccountClient, saveAccountToken } from "./account-session";
import { saveKeyForSession } from "./key-session";

export type SignInOutcome =
  | { kind: "signed-in" }
  | { kind: "linked"; recoveryKey: string };

/** Signup stores the normalized form, so login and recovery must match it. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Sign in, unwrap the vault (or link a fresh key when there is none) and store
 * the key. Throws the account client's error so pages can render one generic
 * message without revealing why authentication failed.
 */
export async function signInWithPassword(
  email: string,
  password: string,
  remember: boolean,
): Promise<SignInOutcome> {
  const accountEmail = normalizeEmail(email);
  const salt = await deriveKdfSalt(accountEmail);
  const masterKey = await deriveMasterKey(password, salt);
  const authHash = await deriveAuthHash(masterKey);
  const client = createAccountClient();
  const session = await client.login({ email: accountEmail, authHash });

  if (session.vault !== null) {
    const wrapKey = await deriveWrapKey(masterKey);
    const rawKey = await unwrapSyncKey(
      wrapKey,
      session.vault.wrappedKey,
      session.vault.authId,
    );
    saveAccountToken(session.token);
    saveKeyForSession(formatKey(rawKey), remember);
    return { kind: "signed-in" };
  }

  // The account exists but never linked a key: create this device's key.
  const rawKey = parseKey(generateKey());
  const { authId, authKey } = await deriveKeys(rawKey);
  const wrapKey = await deriveWrapKey(masterKey);
  const wrappedKey = await wrapSyncKey(wrapKey, rawKey, authId);
  await client.linkKey(session.token, {
    authId,
    authKey,
    wrappedKey,
    authHash,
  });

  saveAccountToken(session.token);
  return {
    kind: "linked",
    recoveryKey: saveKeyForSession(formatKey(rawKey), remember),
  };
}

/**
 * Replace the password proof with the recovery key, re-wrap the same raw key,
 * then sign in with the new password and store the key.
 *
 * Recovery always writes the vault; the fallback keeps the key in hand if the
 * server has not surfaced it on the immediate login instead of generating a
 * different key.
 */
export async function recoverAccount(
  email: string,
  recoveryKey: string,
  newPassword: string,
): Promise<void> {
  const accountEmail = normalizeEmail(email);
  const rawKey = parseKey(recoveryKey);
  const { authId, authKey } = await deriveKeys(rawKey);
  const salt = await deriveKdfSalt(accountEmail);
  const masterKey = await deriveMasterKey(newPassword, salt);
  const authHash = await deriveAuthHash(masterKey);
  const wrapKey = await deriveWrapKey(masterKey);
  const wrappedKey = await wrapSyncKey(wrapKey, rawKey, authId);
  const client = createAccountClient();

  await client.recover({
    email: accountEmail,
    authId,
    authKey,
    authHash,
    kdfSalt: encodeSalt(salt),
    kdfIterations: KDF_ITERATIONS,
    wrappedKey,
  });

  // The reset revoked every old token; sign in with the new proof.
  const session = await client.login({ email: accountEmail, authHash });
  saveAccountToken(session.token);

  if (session.vault !== null) {
    const sessionRawKey = await unwrapSyncKey(
      wrapKey,
      session.vault.wrappedKey,
      session.vault.authId,
    );
    saveKeyForSession(formatKey(sessionRawKey));
  } else {
    saveKeyForSession(formatKey(rawKey));
  }
}
