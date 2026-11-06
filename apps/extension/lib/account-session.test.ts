/**
 * Account session reconciliation: linking a device key, adopting an account
 * vault, re-linking after a key change, and changing the password.
 *
 * The account HTTP client is mocked at the class boundary; every KDF, vault
 * and key-storage helper is the real implementation, so these tests exercise
 * the same derivations the extension runs in production. Local sessions live
 * in the real (fake-indexeddb) sessions database.
 */

import { webcrypto } from "node:crypto";

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
  type AccountProfile,
  type AccountVault,
  type Session,
} from "@savetabs/shared";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE } from "./config";
import { SESSIONS_DB_NAME, closeSessionsDb } from "./sessions-db";
import { addSession, listSessions } from "./sessions-repo";
import {
  EXTENSION_ACCOUNT_TOKEN_KEY,
  changePassword,
  linkDeviceKey,
  reLinkAfterKeyChange,
  signIn,
} from "./account-session";
import { SYNC_KEY_REBIND_STORAGE_KEY, getKey, setKey } from "./sync/key-store";
import { rotateSyncKey } from "./sync/sync-lifecycle";

// jsdom ships a Crypto object without SubtleCrypto; the real crypto primitives
// are the ones under test, so fall back to Node's WebCrypto implementation.
if (typeof globalThis.crypto?.subtle === "undefined") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}

const { clientMock } = vi.hoisted(() => ({
  clientMock: {
    signup: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    linkKey: vi.fn(),
    changePassword: vi.fn(),
  },
}));

vi.mock("@savetabs/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@savetabs/shared")>();
  return {
    ...actual,
    AccountClient: function AccountClientMock() {
      return clientMock;
    },
  };
});

const EMAIL = "a@example.com";
const PASSWORD = "a-long-password-123";
const NEW_PASSWORD = "another-long-password-456";
const TOKEN = "extension-account-token";
const NEW_TOKEN = "replacement-account-token";
const AUTH_ID = "vault-auth-id";
const DEVICE_KEY = formatKey(new Uint8Array(16).fill(9));
const ACCOUNT_KEY = formatKey(new Uint8Array(16).fill(7));

const PROFILE: AccountProfile = {
  id: "account-1",
  email: EMAIL,
  emailVerified: true,
  authId: AUTH_ID,
  locale: "en",
};

const PROFILE_WITHOUT_VAULT: AccountProfile = { ...PROFILE, authId: null };

type KeyMaterial = {
  salt: Uint8Array;
  masterKey: Uint8Array;
  wrapKey: CryptoKey;
  authHash: string;
};

let material: KeyMaterial;

beforeAll(async () => {
  const salt = await deriveKdfSalt(EMAIL);
  const masterKey = await deriveMasterKey(PASSWORD, salt);
  material = {
    salt,
    masterKey,
    wrapKey: await deriveWrapKey(masterKey),
    authHash: await deriveAuthHash(masterKey),
  };
}, 30_000);

function makeSession(id: string): Session {
  return { id, createdAt: 1, updatedAt: 1, source: "window", tabs: [] };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SESSIONS_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("deleteDatabase failed"));
    request.onblocked = () => reject(new Error("deleteDatabase blocked"));
  });
}

async function rememberToken(token = TOKEN): Promise<void> {
  await fakeBrowser.storage.local.set({
    [EXTENSION_ACCOUNT_TOKEN_KEY]: token,
  });
}

async function storedToken(): Promise<unknown> {
  const stored = await fakeBrowser.storage.local.get(
    EXTENSION_ACCOUNT_TOKEN_KEY,
  );
  return stored[EXTENSION_ACCOUNT_TOKEN_KEY];
}

async function storedRebind(): Promise<unknown> {
  const stored = await fakeBrowser.storage.local.get(
    SYNC_KEY_REBIND_STORAGE_KEY,
  );
  return stored[SYNC_KEY_REBIND_STORAGE_KEY];
}

/** A login vault wrapping `rawKey` exactly as the account server stores it. */
async function vaultFor(rawKey: string): Promise<AccountVault> {
  return {
    wrappedKey: await wrapSyncKey(material.wrapKey, parseKey(rawKey), AUTH_ID),
    kdfSalt: encodeSalt(material.salt),
    kdfIterations: KDF_ITERATIONS,
    authId: AUTH_ID,
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  await closeSessionsDb();
  await deleteDatabase();
  for (const mock of Object.values(clientMock)) mock.mockReset();
  clientMock.linkKey.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await closeSessionsDb();
  await deleteDatabase();
  fakeBrowser.reset();
});

describe("linkDeviceKey", () => {
  it("links the existing device key instead of creating a vault", async () => {
    await rememberToken();
    await setKey(DEVICE_KEY);

    const result = await linkDeviceKey(PROFILE_WITHOUT_VAULT, null, PASSWORD);

    expect(await getKey()).toBe(DEVICE_KEY);
    expect(result.recoveryKey).toBe(DEVICE_KEY);

    const [tokenArg, body] = clientMock.linkKey.mock.calls[0];
    expect(tokenArg).toBe(TOKEN);
    const derived = await deriveKeys(parseKey(DEVICE_KEY));
    expect(body).toMatchObject({
      authId: derived.authId,
      authKey: derived.authKey,
      authHash: material.authHash,
    });
    expect(body.replace).toBeUndefined();
    const unwrapped = await unwrapSyncKey(
      material.wrapKey,
      body.wrappedKey,
      derived.authId,
    );
    expect(unwrapped).toEqual(parseKey(DEVICE_KEY));
  }, 30_000);

  it("generates and links a key when neither the account nor the device has one", async () => {
    await rememberToken();

    const result = await linkDeviceKey(PROFILE_WITHOUT_VAULT, null, PASSWORD);

    const key = await getKey();
    expect(key).toBeDefined();
    expect(result.recoveryKey).toBe(key);
    expect(clientMock.linkKey).toHaveBeenCalledTimes(1);
    const [, body] = clientMock.linkKey.mock.calls[0];
    const derived = await deriveKeys(parseKey(key as string));
    expect(body.authId).toBe(derived.authId);
    expect(body.wrappedKey).toBeDefined();
  }, 30_000);

  it("adopts the account vault and asks before uploading local sessions", async () => {
    await setKey(DEVICE_KEY);
    await addSession(makeSession("local-1"));
    await addSession(makeSession("local-2"));
    const vault = await vaultFor(ACCOUNT_KEY);
    const confirmUploadPrompt = vi.fn().mockResolvedValue(true);

    await linkDeviceKey(PROFILE, vault, PASSWORD, {
      confirmUpload: confirmUploadPrompt,
    });

    expect(await getKey()).toBe(ACCOUNT_KEY);
    expect(confirmUploadPrompt).toHaveBeenCalledTimes(1);
    expect(confirmUploadPrompt).toHaveBeenCalledWith(2);
    await expect(storedRebind()).resolves.toBe("upload");
    // Local sessions are never deleted by the key switch.
    await expect(listSessions()).resolves.toHaveLength(2);
    expect(clientMock.linkKey).not.toHaveBeenCalled();
  }, 30_000);

  it("marks local sessions local-only when the upload offer is declined", async () => {
    await setKey(DEVICE_KEY);
    await addSession(makeSession("local-1"));
    const vault = await vaultFor(ACCOUNT_KEY);
    const confirmUploadPrompt = vi.fn().mockResolvedValue(false);

    await linkDeviceKey(PROFILE, vault, PASSWORD, {
      confirmUpload: confirmUploadPrompt,
    });

    expect(await getKey()).toBe(ACCOUNT_KEY);
    await expect(storedRebind()).resolves.toBe("skip");
    await expect(listSessions()).resolves.toHaveLength(1);
  }, 30_000);

  it("does not ask about uploads when there are no local sessions", async () => {
    await setKey(DEVICE_KEY);
    const confirmUploadPrompt = vi.fn().mockResolvedValue(true);

    await linkDeviceKey(PROFILE, await vaultFor(ACCOUNT_KEY), PASSWORD, {
      confirmUpload: confirmUploadPrompt,
    });

    expect(await getKey()).toBe(ACCOUNT_KEY);
    expect(confirmUploadPrompt).not.toHaveBeenCalled();
  }, 30_000);

  it("keeps the current key when it already matches the account vault", async () => {
    // A pending decision from an earlier key change must not be overwritten
    // when the account vault already holds the device's key.
    await setKey(ACCOUNT_KEY, "skip");
    await addSession(makeSession("local-1"));
    const confirmUploadPrompt = vi.fn().mockResolvedValue(true);

    await linkDeviceKey(PROFILE, await vaultFor(ACCOUNT_KEY), PASSWORD, {
      confirmUpload: confirmUploadPrompt,
    });

    expect(await getKey()).toBe(ACCOUNT_KEY);
    expect(confirmUploadPrompt).not.toHaveBeenCalled();
    await expect(storedRebind()).resolves.toBe("skip");
  }, 30_000);
});

describe("signIn", () => {
  it("links the device key for an account without a vault", async () => {
    await setKey(DEVICE_KEY, "skip");
    clientMock.login.mockResolvedValue({
      token: TOKEN,
      account: PROFILE_WITHOUT_VAULT,
      vault: null,
    });

    const result = await signIn(EMAIL, PASSWORD);

    expect(result).toMatchObject({ recoveryKey: DEVICE_KEY });
    expect(await getKey()).toBe(DEVICE_KEY);
    expect(clientMock.linkKey).toHaveBeenCalledTimes(1);
    await expect(storedToken()).resolves.toBe(TOKEN);
  }, 30_000);

  it("adopts the account vault and forwards the upload decision", async () => {
    await setKey(DEVICE_KEY);
    await addSession(makeSession("local-1"));
    clientMock.login.mockResolvedValue({
      token: TOKEN,
      account: PROFILE,
      vault: await vaultFor(ACCOUNT_KEY),
    });
    const confirmUploadPrompt = vi.fn().mockResolvedValue(false);

    const result = await signIn(EMAIL, PASSWORD, {
      confirmUpload: confirmUploadPrompt,
    });

    expect(result).toMatchObject({ recoveryKey: null });
    expect(await getKey()).toBe(ACCOUNT_KEY);
    expect(confirmUploadPrompt).toHaveBeenCalledTimes(1);
    await expect(storedRebind()).resolves.toBe("skip");
    await expect(storedToken()).resolves.toBe(TOKEN);
  }, 30_000);
});

describe("reLinkAfterKeyChange", () => {
  it("does nothing while signed out", async () => {
    await reLinkAfterKeyChange(generateKey(), PASSWORD);

    expect(clientMock.linkKey).not.toHaveBeenCalled();
    expect(clientMock.me).not.toHaveBeenCalled();
  });

  it("wraps the new key for its own authId and replaces the account link", async () => {
    await rememberToken();
    clientMock.me.mockResolvedValue(PROFILE);
    const newKey = generateKey();

    await reLinkAfterKeyChange(newKey, PASSWORD);

    const [tokenArg, body] = clientMock.linkKey.mock.calls[0];
    expect(tokenArg).toBe(TOKEN);
    const derived = await deriveKeys(parseKey(newKey));
    expect(body).toMatchObject({
      authId: derived.authId,
      authKey: derived.authKey,
      authHash: material.authHash,
      replace: true,
    });
    const unwrapped = await unwrapSyncKey(
      material.wrapKey,
      body.wrappedKey,
      derived.authId,
    );
    expect(unwrapped).toEqual(parseKey(newKey));
  }, 30_000);
});

describe("rotateSyncKey", () => {
  it("re-links the new key before deleting the old cloud data", async () => {
    const oldKey = generateKey();
    await setKey(oldKey);
    await rememberToken();
    clientMock.me.mockResolvedValue(PROFILE);
    const order: string[] = [];
    clientMock.linkKey.mockImplementation(async () => {
      order.push("relink");
      return { ok: true };
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => {
        order.push("delete-old-data");
        return new Response(null, { status: 204 });
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await rotateSyncKey(PASSWORD);

    expect(await getKey()).toBe(result.key);
    expect(result.key).not.toBe(oldKey);
    expect(order).toEqual(["relink", "delete-old-data"]);

    const [, body] = clientMock.linkKey.mock.calls[0];
    const derived = await deriveKeys(parseKey(result.key));
    expect(body).toMatchObject({ authId: derived.authId, replace: true });
    const unwrapped = await unwrapSyncKey(
      material.wrapKey,
      body.wrappedKey,
      derived.authId,
    );
    expect(unwrapped).toEqual(parseKey(result.key));

    const oldDerived = await deriveKeys(parseKey(oldKey));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${API_BASE}/v1/keys/${oldDerived.authId}`,
    );
    await expect(storedRebind()).resolves.toBe("upload");
  }, 30_000);

  it("aborts rotation and keeps the old key when the re-link fails", async () => {
    const oldKey = generateKey();
    await setKey(oldKey);
    await rememberToken();
    clientMock.me.mockResolvedValue(PROFILE);
    clientMock.linkKey.mockRejectedValue(new Error("link rejected"));
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const rotateAndRelink = (password: string): ReturnType<typeof rotateSyncKey> =>
      rotateSyncKey(password);

    await expect(rotateAndRelink(PASSWORD)).rejects.toThrow();
    expect(await getKey()).toBe(oldKey);
    // Old cloud data is only deleted after a successful re-link.
    expect(fetchMock).not.toHaveBeenCalled();
  }, 30_000);

  it("requires the account password while signed in", async () => {
    const oldKey = generateKey();
    await setKey(oldKey);
    await rememberToken();

    await expect(rotateSyncKey()).rejects.toThrow();
    expect(await getKey()).toBe(oldKey);
    expect(clientMock.linkKey).not.toHaveBeenCalled();
  }, 30_000);

  it("rotates without a password while signed out", async () => {
    const oldKey = generateKey();
    await setKey(oldKey);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
    );

    const result = await rotateSyncKey();

    expect(await getKey()).toBe(result.key);
    expect(result.key).not.toBe(oldKey);
    expect(clientMock.linkKey).not.toHaveBeenCalled();
  }, 30_000);
});

describe("changePassword", () => {
  it("re-wraps the account key and stores the replacement token", async () => {
    await rememberToken();
    clientMock.me.mockResolvedValue(PROFILE);
    clientMock.login.mockResolvedValue({
      token: "login-proof-token",
      account: PROFILE,
      vault: await vaultFor(ACCOUNT_KEY),
    });
    clientMock.changePassword.mockResolvedValue({ token: NEW_TOKEN });

    await changePassword(PASSWORD, NEW_PASSWORD);

    const [tokenArg, input] = clientMock.changePassword.mock.calls[0];
    expect(tokenArg).toBe(TOKEN);
    expect(input.oldAuthHash).toBe(material.authHash);
    expect(input.kdfSalt).toBe(encodeSalt(material.salt));
    expect(input.kdfIterations).toBe(KDF_ITERATIONS);

    const newMasterKey = await deriveMasterKey(
      NEW_PASSWORD,
      await deriveKdfSalt(EMAIL),
    );
    expect(input.newAuthHash).toBe(await deriveAuthHash(newMasterKey));
    const newWrapKey = await deriveWrapKey(newMasterKey);
    const unwrapped = await unwrapSyncKey(
      newWrapKey,
      input.wrappedKey,
      AUTH_ID,
    );
    expect(unwrapped).toEqual(parseKey(ACCOUNT_KEY));

    await expect(storedToken()).resolves.toBe(NEW_TOKEN);
  }, 30_000);

  it("keeps the current token when the current password is rejected", async () => {
    await rememberToken();
    clientMock.me.mockResolvedValue(PROFILE);
    clientMock.login.mockRejectedValue(new Error("bad password"));

    await expect(changePassword("wrong-password", NEW_PASSWORD)).rejects.toThrow();

    expect(clientMock.changePassword).not.toHaveBeenCalled();
    await expect(storedToken()).resolves.toBe(TOKEN);
  }, 30_000);
});
