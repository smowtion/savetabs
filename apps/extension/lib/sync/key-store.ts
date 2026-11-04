/**
 * Sync key storage.
 *
 * The user key is the only credential for the encrypted cloud data: the server
 * stores only derived public values, so losing the key loses every synced
 * session. This module owns the one copy kept in `storage.local` and the
 * "rebind" decision recorded whenever the key changes.
 *
 * Keys are always validated with `parseKey` and stored in canonical
 * `formatKey` form, so every consumer (options UI, sync service, web app paste
 * field) sees the same spelling. A key imported or rotated from another device
 * sets `syncKeyRebindPending`, which the sync service consumes to decide
 * whether local sessions should be uploaded under the new key.
 */

import {
  formatKey,
  generateKey,
  parseKey,
} from "@savetabs/shared";
import { browser } from "wxt/browser";

/** Storage key holding the formatted `ST-...` user key. */
export const SYNC_KEY_STORAGE_KEY = "syncKey";
/** Storage key holding the pending rebind decision after a key change. */
export const SYNC_KEY_REBIND_STORAGE_KEY = "syncKeyRebindPending";

/** What to do with local sessions after the key changes. */
export type RebindMode = "upload" | "skip";

function normalizeKey(input: string): string {
  // `parseKey` throws InvalidKeyError for malformed input; formatting the
  // parsed bytes drops case, dash and ambiguous-character differences.
  return formatKey(parseKey(input));
}

function normalizeStoredKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return normalizeKey(value);
  } catch {
    return undefined;
  }
}

async function readStoredKey(): Promise<unknown> {
  const stored = await browser.storage.local.get(SYNC_KEY_STORAGE_KEY);
  return stored[SYNC_KEY_STORAGE_KEY];
}

/**
 * Read back whatever another context may have persisted. Creation races are
 * resolved by storage itself: the last write wins, and every context must
 * return that same value or it would show a key nobody else can read.
 */
async function readPersistedKey(): Promise<string | undefined> {
  return normalizeStoredKey(await readStoredKey());
}

/**
 * Return the stored key, or undefined when none is stored or the stored value
 * is not a valid key. The returned value is canonical.
 */
export async function getKey(): Promise<string | undefined> {
  return normalizeStoredKey(await readStoredKey());
}

/**
 * Serializes first-time creation so two mounts (React StrictMode runs effects
 * twice in development) cannot generate competing keys from the same empty
 * storage snapshot.
 */
let creationInFlight: Promise<string> | null = null;

async function createKey(): Promise<string> {
  const stored = await readStoredKey();
  const normalized = normalizeStoredKey(stored);

  if (normalized !== undefined) {
    // Repair spelling drift (lower case, missing dashes) once so other
    // contexts read the canonical form.
    if (normalized !== stored) {
      await browser.storage.local.set({
        [SYNC_KEY_STORAGE_KEY]: normalized,
      });
      return (await readPersistedKey()) ?? normalized;
    }
    return normalized;
  }

  const generated = generateKey();
  await browser.storage.local.set({ [SYNC_KEY_STORAGE_KEY]: generated });
  // A concurrent context may have written another key while this one was
  // creating. Return whatever storage holds, so the displayed key is the one
  // that will actually be used.
  return (await readPersistedKey()) ?? generated;
}

/**
 * Return the stored key, creating and persisting one when it is missing or
 * invalid. Creation never enables sync or schedules a rebind: a fresh install
 * only gets a key ready for the user to write down.
 */
export function getOrCreateKey(): Promise<string> {
  creationInFlight ??= createKey().finally(() => {
    creationInFlight = null;
  });
  return creationInFlight;
}

/**
 * Validate, normalize and store a key. Throws `InvalidKeyError` for malformed
 * input. The rebind decision defaults to uploading local sessions under the
 * new key; pass `"skip"` when the user explicitly declines.
 */
export async function setKey(
  input: string,
  rebind: RebindMode = "upload",
): Promise<string> {
  const key = normalizeKey(input);
  await browser.storage.local.set({
    [SYNC_KEY_STORAGE_KEY]: key,
    [SYNC_KEY_REBIND_STORAGE_KEY]: rebind,
  });
  return key;
}

/**
 * Replace the key with a fresh random one. Data already stored on the server
 * under the old key stays there but becomes unreadable, so rotation schedules
 * a rebind upload of the local sessions.
 */
export async function rotateKey(): Promise<string> {
  const key = generateKey();
  await browser.storage.local.set({
    [SYNC_KEY_STORAGE_KEY]: key,
    [SYNC_KEY_REBIND_STORAGE_KEY]: "upload",
  });
  return key;
}

/**
 * Read the pending rebind decision without clearing it.
 *
 * The retry alarm uses this to apply a staged "skip" before any upload; only
 * after the exclusions are persisted does it consume the marker. An "upload"
 * marker is deliberately left untouched so the next full sync still performs
 * its force-upload.
 */
export async function peekPendingRebind(): Promise<RebindMode | undefined> {
  const stored = await browser.storage.local.get(SYNC_KEY_REBIND_STORAGE_KEY);
  const value = stored[SYNC_KEY_REBIND_STORAGE_KEY];
  return value === "upload" || value === "skip" ? value : undefined;
}

/**
 * Read and clear the pending rebind decision. The sync service calls this
 * exactly once after a key change; a second call returns undefined.
 */
export async function consumePendingRebind(): Promise<RebindMode | undefined> {
  const stored = await browser.storage.local.get(SYNC_KEY_REBIND_STORAGE_KEY);
  const value = stored[SYNC_KEY_REBIND_STORAGE_KEY];
  if (value === undefined) return undefined;

  await browser.storage.local.remove(SYNC_KEY_REBIND_STORAGE_KEY);
  return value === "upload" || value === "skip" ? value : undefined;
}
