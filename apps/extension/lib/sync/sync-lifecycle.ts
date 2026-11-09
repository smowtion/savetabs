/**
 * Background sync lifecycle.
 *
 * Owns the automatic sync triggers that live outside the options page:
 * - a full sync at browser startup when `sync.autoDownload` is on,
 * - an upload of the freshly saved session when `sync.autoUpload` is on,
 * - a five-minute retry alarm that uploads only `pendingUpload` sessions.
 *
 * Every trigger is gated by `sync.enabled` and contains its own failures: a
 * broken network or a rejected key must never crash the service worker or
 * break the save flow. The options page shows the resulting problems through
 * the explicit "Sync now" action instead.
 *
 * The module also records `syncLastAt` in `storage.local` after a completed
 * full sync so the options UI can show a relative timestamp, and owns the
 * "Delete cloud data" primitive, which turns sync off so the kept local
 * sessions are not re-uploaded.
 */

import {
  SyncAuthError,
  SyncClient,
  SyncHttpError,
  deriveKeys,
  generateKey,
  parseKey,
  type Session,
  type Settings,
} from "@savetabs/shared";
import { browser } from "wxt/browser";

import { loadAccountToken, reLinkAfterKeyChange } from "../account-session";
import { API_BASE } from "../config";
import { listSessions, updateSession } from "../sessions-repo";
import { loadSettings, saveSettingNow } from "../settings";
import { getKey, setKey } from "./key-store";
import {
  applySkipRebindIfPending,
  enqueueUpload,
  syncNow,
} from "./sync-service";

/** Alarm that retries pending uploads while sync is enabled. */
export const SYNC_RETRY_ALARM_NAME = "sync-retry";
/** Retry cadence in minutes, matching the alarm period. */
export const SYNC_RETRY_PERIOD_MINUTES = 5;
/**
 * Minimum gap between automatic startup full syncs.
 *
 * On-save uploads and the retry alarm keep local changes flowing; this merge
 * mainly pulls other devices' changes. A browser start is not a reason to
 * spend a full sync per user per day, which would dominate the request budget
 * at scale. Manual sync remains available at any time.
 */
export const SYNC_STARTUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** Storage key holding the epoch-ms timestamp of the last completed full sync. */
export const SYNC_LAST_AT_STORAGE_KEY = "syncLastAt";

function isSyncEnabled(settings: Settings): boolean {
  return settings["sync.enabled"] === true;
}

/** Last completed full sync, or undefined when none is recorded or malformed. */
export async function readLastSyncAt(): Promise<number | undefined> {
  try {
    const stored = await browser.storage.local.get(SYNC_LAST_AT_STORAGE_KEY);
    const value = stored[SYNC_LAST_AT_STORAGE_KEY];
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : undefined;
  } catch {
    // A missing timestamp only makes the UI say "Never"; it is not an error.
    return undefined;
  }
}

/** Record that a full sync completed; storage failures are non-fatal. */
export async function recordSyncCompleted(now = Date.now()): Promise<void> {
  try {
    await browser.storage.local.set({ [SYNC_LAST_AT_STORAGE_KEY]: now });
  } catch (error) {
    console.error("[savetabs] failed to record the last sync time", error);
  }
}

/**
 * Keep the retry alarm in sync with the settings. An existing alarm is left
 * untouched so applying settings does not postpone the next retry.
 */
export async function applySyncAlarm(settings: Settings): Promise<void> {
  if (!isSyncEnabled(settings)) {
    await browser.alarms.clear(SYNC_RETRY_ALARM_NAME);
    return;
  }

  const existing = await browser.alarms.get(SYNC_RETRY_ALARM_NAME);
  if (existing !== undefined) return;

  await browser.alarms.create(SYNC_RETRY_ALARM_NAME, {
    delayInMinutes: SYNC_RETRY_PERIOD_MINUTES,
    periodInMinutes: SYNC_RETRY_PERIOD_MINUTES,
  });
}

/** Run a full sync, recording the timestamp only when it was not rejected. */
async function runFullSync(allowUpload: boolean): Promise<void> {
  try {
    await syncNow({ allowUpload });
    await recordSyncCompleted();
  } catch (error) {
    // Auth problems and network failures are reported by the next manual sync;
    // the worker keeps running either way.
    console.error("[savetabs] background sync failed", error);
  }
}

/**
 * Startup merge: only when sync is enabled and `sync.autoDownload` is on, so
 * a local-only user never touches the network on launch. The upload phase
 * still follows `sync.autoUpload`: a user who disabled automatic uploads gets
 * downloaded changes without their own sessions being pushed.
 */
export async function syncOnStartup(): Promise<void> {
  const settings = await loadSettings();
  if (!isSyncEnabled(settings) || settings["sync.autoDownload"] !== true) {
    return;
  }

  // Startup happens far more often than another device can produce changes.
  // Skip the merge when a recent full sync already covered it.
  const lastSyncAt = await readLastSyncAt();
  if (
    lastSyncAt !== undefined &&
    Date.now() - lastSyncAt < SYNC_STARTUP_INTERVAL_MS
  ) {
    return;
  }

  await runFullSync(settings["sync.autoUpload"] === true);
}

/**
 * Retry alarm handler: upload only local sessions marked `pendingUpload`.
 *
 * Deliberately narrower than `syncNow`: it never lists, downloads or merges
 * remote sessions and never uploads clean local sessions, so it cannot bypass
 * `sync.autoDownload` or `sync.autoUpload`. The alarm only exists while sync
 * is enabled, but a queued alarm can fire after the user disables sync, so
 * both settings are re-checked.
 */
export async function retryPendingUploads(): Promise<void> {
  const settings = await loadSettings();
  if (!isSyncEnabled(settings) || settings["sync.autoUpload"] !== true) return;

  // A "skip upload" key import stages its marker until a full sync consumes
  // it. The alarm can fire first, so persist the exclusions now; an "upload"
  // marker is left for the next full sync's force-upload.
  await applySkipRebindIfPending();

  const pending = (await listSessions()).filter(
    (session) =>
      session.pendingUpload === true &&
      !session.incognito &&
      !session.syncExcluded,
  );

  for (const session of pending) {
    try {
      await enqueueUpload(session);
    } catch (error) {
      // The flag stays set for the next retry, and one failed session must
      // not prevent the others from uploading.
      console.error(
        `[savetabs] failed to retry the upload of ${session.id}`,
        error,
      );
    }
  }
}

/**
 * Upload one freshly saved session. Only that session is passed to the sync
 * service: stored sessions are never re-fed here, so a `syncExcluded` session
 * from a "skip upload" key import cannot leak through the save path. The
 * guards also cover the case where the caller hands us an old session.
 *
 * The session is marked `pendingUpload` before the network attempt, so an
 * interrupted service worker still leaves work for the retry alarm. Failures
 * are contained: the save flow has already closed the tabs and must not undo a
 * successful local save.
 */
export async function syncSavedSession(session: Session): Promise<void> {
  if (session.incognito || session.syncExcluded) return;

  try {
    const settings = await loadSettings();
    if (!isSyncEnabled(settings) || settings["sync.autoUpload"] !== true) return;

    await updateSession(session.id, {
      pendingUpload: true,
      updatedAt: session.updatedAt,
    });
    // Carry the flag in the passed object too: a successful PUT clears it.
    await enqueueUpload({ ...session, pendingUpload: true });
  } catch (error) {
    console.error("[savetabs] failed to upload the saved session", error);
  }
}

/**
 * Delete every session stored on the sync server for the local key.
 *
 * A 404 means the key was never registered on the server (or its data is
 * already gone), which is the desired end state, so it counts as success.
 *
 * After a successful delete, sync is turned off in the same flow. Local
 * sessions are deliberately kept, so leaving sync on would let the retry
 * alarm or the next auto-upload recreate the cloud data immediately. The user
 * can re-enable sync later through the key-saved confirmation. `syncExcluded`
 * flags and every other local field stay untouched.
 */
export async function deleteAllCloudData(): Promise<void> {
  const key = await getKey();
  if (key === undefined) {
    throw new SyncAuthError(
      "No sync key is configured. Create or import a sync key first.",
    );
  }

  const derived = await deriveKeys(parseKey(key));
  const client = new SyncClient(API_BASE, derived.authId, derived.authKey);
  try {
    await client.deleteAll();
  } catch (error) {
    if (!(error instanceof SyncHttpError && error.status === 404)) throw error;
  }

  // The setting must be on disk before success is reported: a crash between
  // the delete and a debounced write would let the retry alarm recreate the
  // cloud data. Clearing the alarm here also covers a worker that is about to
  // be suspended before its settings listener runs.
  await saveSettingNow("sync.enabled", false);
  await browser.alarms.clear(SYNC_RETRY_ALARM_NAME);
}

/** How the previous key's cloud data was handled during rotation. */
export type OldDataRevocation = "deleted" | "failed" | "none";

export type RotateKeyResult = {
  /** The new key in canonical form; already persisted. */
  key: string;
  revocation: OldDataRevocation;
};

/**
 * Rotate the sync key and revoke the old key's cloud data.
 *
 * While signed in, the account password is required: the new key is linked to
 * the account before anything else changes, because an account that still
 * points at the old key would strand every later sign-in. A failed re-link
 * aborts the rotation with the stored key untouched.
 *
 * Only after a successful re-link is the new key and its "upload" rebind
 * decision stored. Deleting the old data is best-effort: a 404 means it was
 * already gone, and any other failure is reported in the result instead of
 * thrown. The old key is never logged.
 */
export async function rotateSyncKey(
  password?: string,
): Promise<RotateKeyResult> {
  const accountPassword = password ?? "";
  const signedIn = (await loadAccountToken()) !== null;
  if (signedIn && accountPassword.length === 0) {
    throw new Error(
      "Your account password is required to rotate the sync key.",
    );
  }

  const oldKey = await getKey();
  const key = generateKey();

  // Persist the new key only after the account accepts it: on failure the
  // stored key and the old cloud data both stay exactly as they were.
  if (signedIn) await reLinkAfterKeyChange(key, accountPassword);
  const storedKey = await setKey(key, "upload");

  if (oldKey === undefined) return { key: storedKey, revocation: "none" };

  try {
    const derived = await deriveKeys(parseKey(oldKey));
    const client = new SyncClient(API_BASE, derived.authId, derived.authKey);
    await client.deleteAll();
    return { key: storedKey, revocation: "deleted" };
  } catch (error) {
    if (error instanceof SyncHttpError && error.status === 404) {
      return { key: storedKey, revocation: "deleted" };
    }
    console.error(
      "[savetabs] failed to delete cloud data for the previous key",
      error,
    );
    return { key: storedKey, revocation: "failed" };
  }
}
