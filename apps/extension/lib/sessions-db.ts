/**
 * IndexedDB access for saved sessions.
 *
 * This module is the only place that opens the `savetabs` database. The public
 * repository in `sessions-repo.ts` builds on these primitives; UI and
 * background code never touch IndexedDB directly.
 *
 * The database holds two stores:
 * - `sessions`: complete sessions keyed by `id`, with an `updatedAt` index.
 * - `tombstones`: deletion records keyed by session `id`, kept so devices that
 *   were offline cannot resurrect a deleted session.
 */

import {
  pruneTombstones,
  type Session,
  type Tombstone,
} from "@savetabs/shared";

export const SESSIONS_DB_NAME = "savetabs";
export const SESSIONS_DB_VERSION = 1;
export const SESSIONS_STORE_NAME = "sessions";
export const TOMBSTONE_STORE_NAME = "tombstones";
export const UPDATED_AT_INDEX_NAME = "updatedAt";

/** Local storage caps enforced when a session is added. */
export type LocalCaps = {
  maxSessions: number;
  maxTabs: number;
};

/**
 * Result of a cap-checked insert. A rejected insert never writes anything.
 * `usage` is the usage before the insert, so callers can build an accurate
 * error message.
 */
export type AddSessionRecordResult =
  | { ok: true }
  | {
      ok: false;
      resource: "sessions" | "tabs";
      usage: number;
      limit: number;
    };

let databasePromise: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this context"));
      return;
    }

    const request = indexedDB.open(SESSIONS_DB_NAME, SESSIONS_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SESSIONS_STORE_NAME)) {
        const sessions = database.createObjectStore(SESSIONS_STORE_NAME, {
          keyPath: "id",
        });
        sessions.createIndex(UPDATED_AT_INDEX_NAME, "updatedAt");
      }
      if (!database.objectStoreNames.contains(TOMBSTONE_STORE_NAME)) {
        database.createObjectStore(TOMBSTONE_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ?? new Error("Failed to open the savetabs database"),
      );
    request.onblocked = () =>
      reject(
        new Error(
          "Opening the savetabs database is blocked by another connection",
        ),
      );
  });
}

/** Deletes tombstones that have reached the shared 30-day retention. */
async function removeExpiredTombstones(
  store: IDBObjectStore,
  now: number,
): Promise<void> {
  const tombstones = (await requestResult(store.getAll())) as Tombstone[];
  const kept = new Set(
    pruneTombstones(tombstones, now).map((tombstone) => tombstone.id),
  );
  for (const tombstone of tombstones) {
    if (!kept.has(tombstone.id)) store.delete(tombstone.id);
  }
}

async function pruneExpiredTombstones(
  database: IDBDatabase,
  now: number,
): Promise<void> {
  const transaction = database.transaction(TOMBSTONE_STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  try {
    await removeExpiredTombstones(
      transaction.objectStore(TOMBSTONE_STORE_NAME),
      now,
    );
    await done;
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

/**
 * Opens the shared database connection, pruning expired tombstones once per
 * open. Concurrent callers share one connection.
 */
export function openSessionsDb(): Promise<IDBDatabase> {
  if (databasePromise === null) {
    const pending = openDatabase().then(async (database) => {
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      try {
        await pruneExpiredTombstones(database, Date.now());
      } catch (error) {
        database.close();
        throw error;
      }
      return database;
    });

    databasePromise = pending.catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

/**
 * Closes the shared connection. Tests use this between cases; the extension
 * can also call it before a version upgrade.
 */
export async function closeSessionsDb(): Promise<void> {
  const pending = databasePromise;
  databasePromise = null;
  if (pending === null) return;
  const database = await pending.catch(() => null);
  database?.close();
}

export async function getAllSessions(
  database: IDBDatabase,
): Promise<Session[]> {
  const transaction = database.transaction(SESSIONS_STORE_NAME, "readonly");
  const done = transactionDone(transaction);
  try {
    const sessions = await requestResult(
      transaction.objectStore(SESSIONS_STORE_NAME).getAll(),
    );
    await done;
    return sessions as Session[];
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

export async function getSessionRecord(
  database: IDBDatabase,
  id: string,
): Promise<Session | undefined> {
  const transaction = database.transaction(SESSIONS_STORE_NAME, "readonly");
  const done = transactionDone(transaction);
  try {
    const session = await requestResult(
      transaction.objectStore(SESSIONS_STORE_NAME).get(id),
    );
    await done;
    return session as Session | undefined;
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

/**
 * Inserts or replaces a session atomically after checking both local caps.
 * An insert that would exceed a cap leaves the database unchanged.
 */
export async function addSessionRecord(
  database: IDBDatabase,
  session: Session,
  caps: LocalCaps,
): Promise<AddSessionRecordResult> {
  const transaction = database.transaction(SESSIONS_STORE_NAME, "readwrite");
  const done = transactionDone(transaction);

  try {
    const store = transaction.objectStore(SESSIONS_STORE_NAME);
    const existing = (await requestResult(store.getAll())) as Session[];
    const replaced = existing.find((candidate) => candidate.id === session.id);

    const sessionCount = existing.length + (replaced ? 0 : 1);
    if (sessionCount > caps.maxSessions) {
      await done;
      return {
        ok: false,
        resource: "sessions",
        usage: existing.length,
        limit: caps.maxSessions,
      };
    }

    const currentTabs = existing.reduce(
      (total, candidate) => total + candidate.tabs.length,
      0,
    );
    const projectedTabs =
      currentTabs - (replaced?.tabs.length ?? 0) + session.tabs.length;
    if (projectedTabs > caps.maxTabs) {
      await done;
      return {
        ok: false,
        resource: "tabs",
        usage: currentTabs,
        limit: caps.maxTabs,
      };
    }

    await requestResult(store.put(session));
    await done;
    return { ok: true };
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

/**
 * Result of a cap-checked update. A rejected update writes nothing. `usage`
 * is the total tab count before the update, matching `AddSessionRecordResult`.
 */
export type UpdateSessionRecordResult =
  | { ok: true; session: Session }
  | {
      ok: false;
      resource: "tabs";
      usage: number;
      limit: number;
    };

/**
 * Applies `mutate` to an existing session inside one read-write transaction,
 * rejecting the update when it would push the total tab count over `maxTabs`.
 * Returns undefined, without writing, when the session does not exist.
 */
export async function updateSessionRecord(
  database: IDBDatabase,
  id: string,
  mutate: (session: Session) => Session,
  maxTabs: number,
): Promise<UpdateSessionRecordResult | undefined> {
  const transaction = database.transaction(SESSIONS_STORE_NAME, "readwrite");
  const done = transactionDone(transaction);

  try {
    const store = transaction.objectStore(SESSIONS_STORE_NAME);
    const current = (await requestResult(store.get(id))) as
      | Session
      | undefined;
    if (current === undefined) {
      await done;
      return undefined;
    }

    const next = mutate(current);
    const existing = (await requestResult(store.getAll())) as Session[];
    const currentTabs = existing.reduce(
      (total, candidate) => total + candidate.tabs.length,
      0,
    );
    const projectedTabs =
      currentTabs - current.tabs.length + next.tabs.length;
    if (projectedTabs > maxTabs) {
      await done;
      return {
        ok: false,
        resource: "tabs",
        usage: currentTabs,
        limit: maxTabs,
      };
    }

    await requestResult(store.put(next));
    await done;
    return { ok: true, session: next };
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

/**
 * Deletes a session, stores its tombstone and prunes expired tombstones in one
 * transaction, so a concurrent reader never sees a deletion without its
 * tombstone.
 */
export async function deleteSessionRecord(
  database: IDBDatabase,
  id: string,
  tombstone: Tombstone,
  now: number,
): Promise<void> {
  const transaction = database.transaction(
    [SESSIONS_STORE_NAME, TOMBSTONE_STORE_NAME],
    "readwrite",
  );
  const done = transactionDone(transaction);

  try {
    const tombstones = transaction.objectStore(TOMBSTONE_STORE_NAME);
    transaction.objectStore(SESSIONS_STORE_NAME).delete(id);
    await requestResult(tombstones.put(tombstone));
    await removeExpiredTombstones(tombstones, now);
    await done;
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

export async function getAllTombstones(
  database: IDBDatabase,
): Promise<Tombstone[]> {
  const transaction = database.transaction(TOMBSTONE_STORE_NAME, "readonly");
  const done = transactionDone(transaction);
  try {
    const tombstones = await requestResult(
      transaction.objectStore(TOMBSTONE_STORE_NAME).getAll(),
    );
    await done;
    return tombstones as Tombstone[];
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}
