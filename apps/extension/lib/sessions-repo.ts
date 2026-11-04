/**
 * Local repository for saved sessions.
 *
 * All extension contexts go through this module: it owns the IndexedDB
 * database, enforces the local caps and announces every mutation so other
 * pages and the service worker can refresh.
 *
 * Favicons are stored exactly as received. The save flow is responsible for
 * dropping oversized favicons before calling `addSession`.
 */

import { LIMITS, type Session, type Tombstone } from "@savetabs/shared";
import { browser } from "wxt/browser";

import {
  addSessionRecord,
  deleteSessionRecord,
  getAllSessions,
  getAllTombstones,
  getSessionRecord,
  openSessionsDb,
  updateSessionRecord,
} from "./sessions-db";

/** Channel used to tell other extension contexts that sessions changed. */
export const SESSIONS_CHANNEL_NAME = "savetabs-events";
/** Message type posted on `SESSIONS_CHANNEL_NAME`. */
export const SESSIONS_CHANGED_MESSAGE_TYPE = "sessions-changed";
/** Storage key whose value changes after every mutation. */
export const SESSIONS_REVISION_KEY = "sessionsRevision";

/**
 * Events arriving close together on both the storage and BroadcastChannel
 * paths describe the same mutation; coalescing them keeps subscribers from
 * refreshing twice.
 */
const CHANGE_COALESCE_MS = 25;

export type SessionsChangedMessage = {
  type: typeof SESSIONS_CHANGED_MESSAGE_TYPE;
};

/** Local storage usage reported by `getUsage`. */
export type SessionsUsage = {
  sessions: number;
  tabs: number;
  /** True once either cap is at or above 90% of its limit. */
  nearLimit: boolean;
};

/** Fields `updateSession` may change. The id and creation time are immutable. */
export type SessionPatch = Partial<Omit<Session, "id" | "createdAt">>;

/**
 * Thrown when adding a session would exceed a local storage cap. Callers must
 * not retry blindly: the user has to export or delete sessions first.
 */
export class LocalQuotaError extends Error {
  constructor(
    readonly resource: "sessions" | "tabs",
    readonly usage: number,
    readonly limit: number,
  ) {
    super(
      resource === "sessions"
        ? `Local session limit reached (${usage}/${limit}); export or delete sessions before saving again`
        : `Local tab limit reached (${usage}/${limit}); delete sessions before saving more tabs`,
    );
    this.name = "LocalQuotaError";
  }
}

function isNearLimit(count: number, limit: number): boolean {
  // Integer math avoids floating-point drift at exactly 90%.
  return count * 10 >= limit * 9;
}

function compareSessions(left: Session, right: Session): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

function createBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(SESSIONS_CHANNEL_NAME);
  } catch {
    return null;
  }
}

/**
 * Announces that sessions changed to every other extension context.
 *
 * The storage revision and the channel message are both best effort: a
 * notification failure must never turn a successful write into an error.
 */
async function notifySessionsChanged(): Promise<void> {
  try {
    await browser.storage.local.set({ [SESSIONS_REVISION_KEY]: Date.now() });
  } catch (error) {
    console.error("[savetabs] failed to record the sessions revision", error);
  }
  broadcastSessionsChanged();
}

/**
 * Posts a `sessions-changed` message on `savetabs-events`. When
 * BroadcastChannel is unavailable the storage revision still notifies
 * listeners through `onSessionsChanged`.
 */
export function broadcastSessionsChanged(): void {
  const channel = createBroadcastChannel();
  if (channel === null) return;

  const message: SessionsChangedMessage = {
    type: SESSIONS_CHANGED_MESSAGE_TYPE,
  };
  try {
    channel.postMessage(message);
  } catch (error) {
    console.error("[savetabs] failed to broadcast the sessions change", error);
  } finally {
    channel.close();
  }
}

/** Every stored session, newest first by `updatedAt`, then `createdAt`, then id. */
export async function listSessions(): Promise<Session[]> {
  const database = await openSessionsDb();
  const sessions = await getAllSessions(database);
  return sessions.sort(compareSessions);
}

export async function getSession(id: string): Promise<Session | undefined> {
  const database = await openSessionsDb();
  return getSessionRecord(database, id);
}

/**
 * Stores a new session. Throws `LocalQuotaError` and writes nothing when
 * either local cap would be exceeded; existing sessions are never evicted.
 */
export async function addSession(session: Session): Promise<Session> {
  const database = await openSessionsDb();
  const result = await addSessionRecord(database, session, {
    maxSessions: LIMITS.maxLocalSessions,
    maxTabs: LIMITS.maxLocalTabs,
  });

  if (!result.ok) {
    throw new LocalQuotaError(result.resource, result.usage, result.limit);
  }

  await notifySessionsChanged();
  return session;
}

/**
 * Merges `patch` into a session. `updatedAt` advances to the current time
 * unless the patch supplies its own value. Returns undefined when the session
 * does not exist.
 */
export async function updateSession(
  id: string,
  patch: SessionPatch,
): Promise<Session | undefined> {
  const database = await openSessionsDb();
  const updated = await updateSessionRecord(database, id, (current) => ({
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: patch.updatedAt ?? Date.now(),
  }));

  if (updated === undefined) return undefined;

  await notifySessionsChanged();
  return updated;
}

/**
 * Deletes a session and records a tombstone, pruning tombstones older than
 * 30 days. A tombstone is written even when the session is already gone, so a
 * copy held by another device is still deleted during the next sync.
 */
export async function deleteSession(
  id: string,
  now: number = Date.now(),
): Promise<void> {
  const database = await openSessionsDb();
  await deleteSessionRecord(database, id, { id, deletedAt: now }, now);
  await notifySessionsChanged();
}

export async function getTombstones(): Promise<Tombstone[]> {
  const database = await openSessionsDb();
  return getAllTombstones(database);
}

/** Current local usage and whether either cap is at or above 90%. */
export async function getUsage(): Promise<SessionsUsage> {
  const database = await openSessionsDb();
  const sessions = await getAllSessions(database);
  const tabs = sessions.reduce(
    (total, session) => total + session.tabs.length,
    0,
  );

  return {
    sessions: sessions.length,
    tabs,
    nearLimit:
      isNearLimit(sessions.length, LIMITS.maxLocalSessions) ||
      isNearLimit(tabs, LIMITS.maxLocalTabs),
  };
}

/**
 * Subscribes to session changes from any extension context.
 *
 * Listens to both the `sessionsRevision` storage key and the
 * `savetabs-events` channel: the storage path is the fallback for browsers or
 * pages where BroadcastChannel is unavailable. Events that arrive together
 * from both paths are coalesced. Returns an unsubscribe function.
 */
export function onSessionsChanged(listener: () => void): () => void {
  let disposed = false;
  let coalescing = false;
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

  const notify = () => {
    if (disposed || coalescing) return;
    coalescing = true;
    coalesceTimer = setTimeout(() => {
      coalescing = false;
      coalesceTimer = null;
    }, CHANGE_COALESCE_MS);
    listener();
  };

  const handleStorageChange: Parameters<
    typeof browser.storage.onChanged.addListener
  >[0] = (changes, areaName) => {
    if (areaName !== "local") return;
    if (!(SESSIONS_REVISION_KEY in changes)) return;
    notify();
  };
  browser.storage.onChanged.addListener(handleStorageChange);

  const channel = createBroadcastChannel();
  const handleChannelMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown } | null | undefined;
    if (data?.type !== SESSIONS_CHANGED_MESSAGE_TYPE) return;
    notify();
  };
  channel?.addEventListener("message", handleChannelMessage);

  return () => {
    if (disposed) return;
    disposed = true;
    if (coalesceTimer !== null) clearTimeout(coalesceTimer);
    browser.storage.onChanged.removeListener(handleStorageChange);
    channel?.removeEventListener("message", handleChannelMessage);
    channel?.close();
  };
}
