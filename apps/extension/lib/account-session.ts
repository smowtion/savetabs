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
  type AccountVault,
  type LanguagePreference,
  type LoginResult,
} from "@savetabs/shared";
import { browser } from "wxt/browser";

import { API_BASE } from "./config";
import { listSessions } from "./sessions-repo";
import { loadSettings } from "./settings";
import { getKey, setKey, type RebindMode } from "./sync/key-store";

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
 * Ask whether local sessions should be uploaded under an adopted account key.
 * Receives the number of local sessions.
 */
export type ConfirmUpload = (
  localSessionCount: number,
) => boolean | Promise<boolean>;

export type LinkDeviceKeyOptions = {
  /** Token from the login that produced the profile; defaults to the stored one. */
  token?: string;
  /**
   * Asked only when local sessions exist and the account key replaces a
   * different device key. The default uses `window.confirm`; a context with no
   * prompt available declines, so the sessions stay local-only.
   */
  confirmUpload?: ConfirmUpload;
};

export type LinkDeviceKeyResult = {
  /** Set only when the account had no vault and this device's key was linked. */
  recoveryKey: string | null;
};

/**
 * Fallback copy for callers without a translator. The account card passes a
 * localized `confirmUpload`, so this English text only serves non-UI contexts;
 * a context with no `confirm` function declines rather than uploading silently.
 */
const UPLOAD_PROMPT = "Upload these sessions to this account?";

function defaultConfirmUpload(): boolean {
  const confirmFn = globalThis.confirm;
  if (typeof confirmFn !== "function") return false;
  return confirmFn(UPLOAD_PROMPT);
}

/**
 * Reconcile this device's sync key with the account returned by `login`.
 *
 * An account without a vault never silently gets a second vault: the device's
 * existing key (or a fresh one on a device without a key) is wrapped with the
 * password-derived key and linked, and returned once as the recovery key.
 *
 * An account with a vault adopts the account's key. When that key differs from
 * the device key, local sessions are never deleted: the caller is asked whether
 * to upload them, and the answer is recorded as the existing rebind decision
 * (`"upload"` or `"skip"`) for the sync service to apply.
 */
export async function linkDeviceKey(
  profile: AccountProfile,
  vault: AccountVault | null,
  password: string,
  options: LinkDeviceKeyOptions = {},
): Promise<LinkDeviceKeyResult> {
  const salt = await deriveKdfSalt(normalizeEmail(profile.email));
  const masterKey = await deriveMasterKey(password, salt);
  const authHash = await deriveAuthHash(masterKey);
  const wrapKey = await deriveWrapKey(masterKey);

  if (vault !== null) {
    // The AAD binds the blob to the linked key, so decrypt with the id the
    // server returned rather than the profile (which can lag behind it).
    const rawKey = await unwrapSyncKey(wrapKey, vault.wrappedKey, vault.authId);
    const accountKey = formatKey(rawKey);
    if ((await getKey()) === accountKey) return { recoveryKey: null };

    const localSessions = await listSessions();
    let rebind: RebindMode = "upload";
    if (localSessions.length > 0) {
      const confirmUpload = options.confirmUpload ?? defaultConfirmUpload;
      rebind = (await confirmUpload(localSessions.length)) ? "upload" : "skip";
    }
    await setKey(accountKey, rebind);
    return { recoveryKey: null };
  }

  const token = options.token ?? (await loadAccountToken());
  if (token === null) {
    throw new Error("Sign in before linking a sync key.");
  }

  // Reuse this device's key when it has one, so a key-only user keeps the
  // sessions already on this device; only a device with no key starts fresh.
  const key = (await getKey()) ?? generateKey();
  const rawKey = parseKey(key);
  const { authId, authKey } = await deriveKeys(rawKey);
  const wrappedKey = await wrapSyncKey(wrapKey, rawKey, authId);

  await createAccountClient().linkKey(token, {
    authId,
    authKey,
    wrappedKey,
    authHash,
  });
  const storedKey = await setKey(key, "upload");
  return { recoveryKey: storedKey };
}

/**
 * Sign in and adopt the account's sync key.
 *
 * The vault is wrapped under a password-derived key with AAD bound to the
 * vault's `authId`, so a server that swaps vaults between accounts fails
 * authentication. An account without a vault links this device's key through
 * {@link linkDeviceKey} and returns it as the recovery key.
 *
 * Throws the account client's error so the card can show one generic message
 * without revealing whether the address exists.
 */
export async function signIn(
  email: string,
  password: string,
  options: LinkDeviceKeyOptions = {},
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

  const { recoveryKey } = await linkDeviceKey(
    session.account,
    session.vault,
    password,
    { ...options, token: session.token },
  );
  // The token is stored only after the key reconciliation succeeds, so a
  // failed link cannot leave the card looking signed in on reload.
  await saveAccountToken(session.token);

  return { account: session.account, recoveryKey };
}

/**
 * Create an account, then sign in with the same credentials so the sync key is
 * linked in one path. Signup itself stores only the password proof and KDF
 * parameters; the key material never leaves the device.
 */
export async function signUp(
  email: string,
  password: string,
  options: LinkDeviceKeyOptions = {},
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

  return signIn(email, password, options);
}

/**
 * Re-wrap `newKey` under the signed-in account's password and replace the
 * account's linked key.
 *
 * Key rotation and import call this before old cloud data is deleted or the
 * new key is applied locally: when the re-link fails the account keeps its old
 * vault, so the caller can abort with the old key intact. A key-only install
 * (no account token) has nothing to re-link and returns immediately.
 */
export async function reLinkAfterKeyChange(
  newKey: string,
  password: string,
): Promise<void> {
  const token = await loadAccountToken();
  if (token === null) return;

  const client = createAccountClient();
  // The email supplies the KDF salt; fetching the profile also revalidates
  // the token before any key material is sent.
  const profile = await client.me(token);
  const accountEmail = normalizeEmail(profile.email);
  const salt = await deriveKdfSalt(accountEmail);
  const masterKey = await deriveMasterKey(password, salt);
  const authHash = await deriveAuthHash(masterKey);

  // Prove the password before replacing the vault. The server only checks the
  // proof when the submitted key id differs from the linked one, so without
  // this a mistyped password for the already-linked key would overwrite the
  // vault under the wrong password. A failed login aborts with no changes.
  await client.login({ email: accountEmail, authHash });

  const wrapKey = await deriveWrapKey(masterKey);
  const rawKey = parseKey(newKey);
  const { authId, authKey } = await deriveKeys(rawKey);
  const wrappedKey = await wrapSyncKey(wrapKey, rawKey, authId);

  await client.linkKey(token, {
    authId,
    authKey,
    wrappedKey,
    authHash,
    replace: true,
  });
}

/**
 * Change the account password and re-wrap the account's sync key under it.
 *
 * The current password is proved by a login, whose vault supplies the
 * canonical sync key. The KDF salt is derived from the email, so it does not
 * change. The server revokes every other session and returns the replacement
 * token, which is stored so this extension stays signed in.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const token = await loadAccountToken();
  if (token === null) {
    throw new Error("Sign in before changing the password.");
  }

  const client = createAccountClient();
  const profile = await client.me(token);
  const accountEmail = normalizeEmail(profile.email);
  const salt = await deriveKdfSalt(accountEmail);
  const oldMasterKey = await deriveMasterKey(currentPassword, salt);
  const oldAuthHash = await deriveAuthHash(oldMasterKey);
  const session = await client.login({
    email: accountEmail,
    authHash: oldAuthHash,
  });
  if (session.vault === null) {
    throw new Error("This account has no linked sync key yet.");
  }

  // Re-wrap the account's own key, not whatever this device happens to store:
  // another device may hold a different local key.
  const oldWrapKey = await deriveWrapKey(oldMasterKey);
  const rawKey = await unwrapSyncKey(
    oldWrapKey,
    session.vault.wrappedKey,
    session.vault.authId,
  );

  const newMasterKey = await deriveMasterKey(newPassword, salt);
  const newAuthHash = await deriveAuthHash(newMasterKey);
  const newWrapKey = await deriveWrapKey(newMasterKey);
  const wrappedKey = await wrapSyncKey(
    newWrapKey,
    rawKey,
    session.vault.authId,
  );

  const result = await client.changePassword(token, {
    oldAuthHash,
    newAuthHash,
    kdfSalt: encodeSalt(salt),
    kdfIterations: KDF_ITERATIONS,
    wrappedKey,
  });
  await saveAccountToken(result.token);
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
