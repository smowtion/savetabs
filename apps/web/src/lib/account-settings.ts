/**
 * Account settings actions for the web app.
 *
 * The password never leaves the browser and the master key never reaches the
 * worker. Every action that needs the sync key derives it locally:
 * - `login` is used as the password proof for the vault operations, so the
 *   account's canonical sync key (the one wrapped in the vault) is used no
 *   matter which key this device last stored;
 * - password change re-wraps that same key under the new password; the KDF
 *   salt is derived from the email, so it does not change;
 * - deletion of the cloud data uses the key-derived sync credentials and runs
 *   before the account is deleted, so a failure can still be retried;
 * - sign-out always clears the local token, even when the server revoke fails.
 *
 * The recovery key is only returned to the caller for display after a fresh
 * password proof; it is never persisted or placed in a URL.
 */

import {
  KDF_ITERATIONS,
  SyncClient,
  SyncHttpError,
  deriveAuthHash,
  deriveKeys,
  deriveKdfSalt,
  deriveMasterKey,
  deriveWrapKey,
  encodeSalt,
  formatKey,
  unwrapSyncKey,
  wrapSyncKey,
  type AccountClient,
} from "@savetabs/shared";

import {
  clearAccountToken,
  createAccountClient,
  saveAccountToken,
} from "./account-session";
import { API_BASE } from "./config";
import { loadKey, saveKeyForSession } from "./key-session";

/** Thrown when the account has no vault to re-wrap or reveal. */
export class MissingVaultError extends Error {
  constructor() {
    super("This account has no linked sync key yet.");
    this.name = "MissingVaultError";
  }
}

type VaultMaterial = {
  salt: Uint8Array;
  authHash: string;
  authId: string;
  rawKey: Uint8Array;
};

/** Prove the password with a login and unwrap the account's sync key. */
async function unlockVault(
  client: AccountClient,
  email: string,
  password: string,
): Promise<VaultMaterial> {
  const salt = await deriveKdfSalt(email);
  const masterKey = await deriveMasterKey(password, salt);
  const authHash = await deriveAuthHash(masterKey);
  const wrapKey = await deriveWrapKey(masterKey);

  const session = await client.login({ email, authHash });
  if (session.vault === null) throw new MissingVaultError();

  // The vault is bound to the sync key's authId; never trust another id.
  const rawKey = await unwrapSyncKey(
    wrapKey,
    session.vault.wrappedKey,
    session.vault.authId,
  );
  return { salt, authHash, authId: session.vault.authId, rawKey };
}

/**
 * Replace the password proof, re-wrap the account's sync key under the new
 * password, and store the replacement account token. Returns the new token so
 * the page can keep using it: the server revokes every old token.
 */
export async function changeAccountPassword(
  token: string,
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<string> {
  const client = createAccountClient();
  const material = await unlockVault(client, email, currentPassword);

  const newMasterKey = await deriveMasterKey(newPassword, material.salt);
  const newAuthHash = await deriveAuthHash(newMasterKey);
  const newWrapKey = await deriveWrapKey(newMasterKey);
  const wrappedKey = await wrapSyncKey(
    newWrapKey,
    material.rawKey,
    material.authId,
  );

  const result = await client.changePassword(token, {
    oldAuthHash: material.authHash,
    newAuthHash,
    kdfSalt: encodeSalt(material.salt),
    kdfIterations: KDF_ITERATIONS,
    wrappedKey,
  });

  saveAccountToken(result.token);
  // Keep the sync key available for this tab when it was not stored yet;
  // never overwrite an existing remember-on-device choice.
  if (loadKey() === null) saveKeyForSession(formatKey(material.rawKey));
  return result.token;
}

/** Return the account's recovery key after verifying the password again. */
export async function revealRecoveryKey(
  email: string,
  password: string,
): Promise<string> {
  const material = await unlockVault(createAccountClient(), email, password);
  return formatKey(material.rawKey);
}

/**
 * Revoke the account token and always remove it locally. A failed server
 * revoke must not trap the user in a signed-in state; the orphaned token
 * expires on its own.
 */
export async function signOutAccount(token: string): Promise<void> {
  try {
    await createAccountClient().logout(token);
  } catch {
    // The local token is cleared below regardless.
  }
  clearAccountToken();
}

export type DeleteAccountParams = {
  token: string;
  email: string;
  password: string;
  /** Delete the cloud data for the account's sync key before the account. */
  deleteCloudData: boolean;
};

/**
 * Delete the account after proving the password. The sync data is only
 * touched when the caller asks for it, and then through the key-derived sync
 * credentials (the account API never touches sync tables).
 */
export async function deleteAccountWithPassword({
  token,
  email,
  password,
  deleteCloudData,
}: DeleteAccountParams): Promise<void> {
  const client = createAccountClient();
  const salt = await deriveKdfSalt(email);
  const masterKey = await deriveMasterKey(password, salt);
  const authHash = await deriveAuthHash(masterKey);

  if (deleteCloudData) {
    // Delete first: if this fails the account still exists and can be retried.
    const session = await client.login({ email, authHash });
    if (session.vault !== null) {
      const wrapKey = await deriveWrapKey(masterKey);
      const rawKey = await unwrapSyncKey(
        wrapKey,
        session.vault.wrappedKey,
        session.vault.authId,
      );
      const { authId, authKey } = await deriveKeys(rawKey);
      try {
        await new SyncClient(API_BASE, authId, authKey).deleteAll();
      } catch (error) {
        // A retry after a partial delete finds no key row. The data is
        // already gone, which is the desired state, so finish the account
        // deletion instead of trapping the user in a failing retry loop.
        if (!(error instanceof SyncHttpError && error.status === 404)) {
          throw error;
        }
      }
    }
  }

  await client.deleteAccount(token, { authHash });
  clearAccountToken();
}
