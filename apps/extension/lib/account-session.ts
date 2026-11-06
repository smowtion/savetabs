/**
 * Account session for the extension: token storage, sign-in, sign-up and
 * sign-out.
 *
 * The account is a vault for the existing sync key, never a replacement for it.
 * The password is stretched with the shared KDF and only the HMAC proof leaves
 * the device; the vault is decrypted locally with an AAD bound to its `authId`.
 *
 * An account with no vault yet adopts this device's key when one exists (a
 * key-only user with local sessions), otherwise a fresh key is generated. That
 * key becomes the account's recovery key, so sign-in returns it once for the
 * required acknowledgement dialog.
 *
 * Signing out removes only the account token: the sync key and the sync
 * settings stay untouched, so sync continues under the key.
 */

import {
  AccountApiError,
  AccountClient,
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
  resolveLang,
  unwrapSyncKey,
  wrapSyncKey,
  type AccountProfile,
  type LanguagePreference,
  type LoginResult,
} from "@savetabs/shared";
import { browser } from "wxt/browser";

import { API_BASE } from "./config";
import { loadSettings } from "./settings";
import { getKey, setKey } from "./sync/key-store";

/** Key used in `storage.local` for the opaque account bearer token. */
export const EXTENSION_ACCOUNT_TOKEN_KEY = "accountToken";

/** Signup stores the normalized form, so login and recovery must match it. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Result of a successful sign-in. `recoveryKey` is set only when the account
 * had no vault yet and this device's key was linked, because that key is the
 * account's recovery key and is shown once.
 */
export type AccountSessionResult = {
  account: AccountProfile;
  recoveryKey: string | null;
};

/** Create a client bound to the configured account API. */
export function createAccountClient(): AccountClient {
  return new AccountClient(API_BASE);
}

function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "auto" || value === "en" || value === "vi";
}

async function currentLocale(): Promise<LanguagePreference> {
  const settings = await loadSettings();
  const preference = settings["general.language"];
  return isLanguagePreference(preference) ? preference : "auto";
}

/** Store the account token for later authenticated requests. */
export async function saveAccountToken(token: string): Promise<void> {
  await browser.storage.local.set({ [EXTENSION_ACCOUNT_TOKEN_KEY]: token });
}

/** Load the stored account token, or `null` when there is none. */
export async function loadAccountToken(): Promise<string | null> {
  const stored = await browser.storage.local.get(EXTENSION_ACCOUNT_TOKEN_KEY);
  const token = stored[EXTENSION_ACCOUNT_TOKEN_KEY];
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** Remove the stored account token on sign-out. */
export async function clearAccountToken(): Promise<void> {
  await browser.storage.local.remove(EXTENSION_ACCOUNT_TOKEN_KEY);
}

/**
 * Sign in and adopt the account's sync key.
 *
 * The vault is wrapped under a password-derived key with AAD bound to the
 * vault's `authId`, so a server that swaps vaults between accounts fails
 * authentication. An account without a vault links this device's key (or a
 * fresh one) with the key-derived bearer and returns it as the recovery key.
 *
 * Throws the account client's error so the card can show one generic message
 * without revealing whether the address exists.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<AccountSessionResult> {
  const accountEmail = normalizeEmail(email);
  const salt = await deriveKdfSalt(accountEmail);
  const masterKey = await deriveMasterKey(password, salt);
  const authHash = await deriveAuthHash(masterKey);
  const client = createAccountClient();
  const session: LoginResult = await client.login({
    email: accountEmail,
    authHash,
  });

  if (session.vault !== null) {
    const wrapKey = await deriveWrapKey(masterKey);
    const rawKey = await unwrapSyncKey(
      wrapKey,
      session.vault.wrappedKey,
      session.vault.authId,
    );
    await setKey(formatKey(rawKey), "upload");
    await saveAccountToken(session.token);
    return { account: session.account, recoveryKey: null };
  }

  // The account exists but never linked a key. Reuse this device's key when it
  // has one, so a key-only user keeps the sessions already on this device;
  // only a device with no key starts with a fresh one.
  const key = (await getKey()) ?? generateKey();
  const rawKey = parseKey(key);
  const { authId, authKey } = await deriveKeys(rawKey);
  const wrapKey = await deriveWrapKey(masterKey);
  const wrappedKey = await wrapSyncKey(wrapKey, rawKey, authId);

  await client.linkKey(session.token, {
    authId,
    authKey,
    wrappedKey,
    authHash,
  });
  const storedKey = await setKey(key, "upload");
  await saveAccountToken(session.token);

  return { account: session.account, recoveryKey: storedKey };
}

/**
 * Create an account, then sign in with the same credentials so the sync key is
 * linked in one path. Signup itself stores only the password proof and KDF
 * parameters; the key material never leaves the device.
 */
export async function signUp(
  email: string,
  password: string,
): Promise<AccountSessionResult> {
  const accountEmail = normalizeEmail(email);
  const salt = await deriveKdfSalt(accountEmail);
  const masterKey = await deriveMasterKey(password, salt);
  const authHash = await deriveAuthHash(masterKey);
  const preference = await currentLocale();

  await createAccountClient().signup({
    email: accountEmail,
    authHash,
    kdfSalt: encodeSalt(salt),
    kdfIterations: KDF_ITERATIONS,
    locale: resolveLang(preference, navigator.language),
  });

  return signIn(email, password);
}

/**
 * Sign out locally and revoke the token server-side best-effort. The sync key
 * and every sync setting are deliberately left in place.
 */
export async function signOut(): Promise<void> {
  const token = await loadAccountToken();
  if (token !== null) {
    try {
      await createAccountClient().logout(token);
    } catch (error) {
      // The token is removed locally regardless; an offline logout must not
      // strand the user in a signed-in card.
      console.warn("[savetabs] account logout failed", error);
    }
  }
  await clearAccountToken();
}

/**
 * Load the signed-in profile from the stored token. An expired or revoked
 * token (HTTP 401) is cleared and reported as signed out; other failures are
 * surfaced to the caller.
 */
export async function getAccount(): Promise<AccountProfile | null> {
  const token = await loadAccountToken();
  if (token === null) return null;

  try {
    return await createAccountClient().me(token);
  } catch (error) {
    if (error instanceof AccountApiError && error.status === 401) {
      await clearAccountToken();
      return null;
    }
    throw error;
  }
}
