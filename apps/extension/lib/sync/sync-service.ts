/**
 * Encrypted sync service for the extension.
 *
 * This module owns the client-side half of the sync protocol: it encrypts
 * sessions before they leave the device, merges the server's encrypted blobs
 * into IndexedDB, pushes local changes, and relays tombstones in both
 * directions. The server never sees sessions in plaintext.
 *
 * Behaviour that callers depend on:
 * - Incognito sessions are never encrypted for upload and never leave the
 *   device. Sessions marked `syncExcluded` by a "skip upload" key import are
 *   never uploaded either.
 * - Oversized sessions stay local and produce a visible error; they are never
 *   sent and never dropped.
 * - A 401 (or a missing key) raises `SyncAuthError` so the UI can show an auth
 *   problem instead of a fake empty state. Other whole-run read failures are
 *   reported in `errors` with a partial result.
 * - Transient per-item failures are collected in `errors` and retried on the
 *   next sync; the affected sessions are marked `pendingUpload`.
 * - `sync.enabled` is the master switch: with it off, nothing touches the
 *   network.
 *
 * The service is created from injectable dependencies so tests can use an
 * in-memory repository and client while exercising the real WebCrypto code.
 */

import {
  LIMITS,
  SyncAuthError,
  SyncClient,
  SyncHttpError,
  decryptSession,
  deriveKeys,
  encryptSession,
  mergeSessions,
  parseKey,
  pruneTombstones,
  type BlobPage,
  type DerivedKeys,
  type RemoteDeletion,
  type RemoteSessionBlob,
  type Session,
  type SessionSummary,
  type Settings,
  type Tombstone,
} from "@savetabs/shared";

import { API_BASE } from "../config";
import { loadSettings } from "../settings";
import {
  addSession,
  deleteSession,
  getTombstones,
  listSessions,
  updateSession,
  type SessionPatch,
} from "../sessions-repo";
import {
  consumePendingRebind,
  getKey,
  type RebindMode,
} from "./key-store";

/** Sessions downloaded per bulk request; matches the server's page cap. */
const BLOB_PAGE_SIZE = 50;

/** Counts and per-item messages produced by one `syncNow` run. */
export type SyncResult = {
  uploaded: number;
  downloaded: number;
  deleted: number;
  errors: string[];
};

/** Subset of `SyncClient` the service needs; tests substitute a fake. */
export type SyncClientApi = {
  listSummaries(): Promise<SessionSummary[]>;
  listBlobs(
    page?: number,
    pageSize?: number,
  ): Promise<{ blobs: RemoteSessionBlob[]; nextPage?: number }>;
  listDeletions(): Promise<RemoteDeletion[]>;
  put(id: string, ciphertext: string, updatedAt: number): Promise<void>;
  delete(id: string): Promise<void>;
};

/** Repository operations the service needs; matches `sessions-repo`. */
export type SyncRepository = {
  listSessions(): Promise<Session[]>;
  getTombstones(): Promise<Tombstone[]>;
  addSession(session: Session): Promise<Session>;
  updateSession(id: string, patch: SessionPatch): Promise<Session | undefined>;
  deleteSession(id: string, now?: number): Promise<void>;
};

export type SyncServiceDeps = {
  repo: SyncRepository;
  getKey(): Promise<string | undefined>;
  consumePendingRebind(): Promise<RebindMode | undefined>;
  loadSettings(): Promise<Settings>;
  createClient(authId: string, authKey: string): SyncClientApi;
  now(): number;
};

export type SyncService = {
  enqueueUpload(session: Session): Promise<void>;
  syncNow(): Promise<SyncResult>;
  applyRemoteDeletions(deletions: readonly RemoteDeletion[]): Promise<number>;
};

const defaultDeps: SyncServiceDeps = {
  repo: { listSessions, getTombstones, addSession, updateSession, deleteSession },
  getKey,
  consumePendingRebind,
  loadSettings,
  createClient: (authId, authKey) => new SyncClient(API_BASE, authId, authKey),
  now: () => Date.now(),
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Byte length of an unpadded base64url string once decoded. The server's
 * `maxSessionBytes` limit applies to the decoded ciphertext, not to the
 * base64 characters.
 */
function decodedByteLength(encoded: string): number {
  return Math.floor((encoded.length * 3) / 4);
}

/** Strip device-local flags; only the shared session shape is encrypted. */
function toRemoteSession(session: Session): Session {
  const copy: Session = { ...session };
  delete copy.pendingUpload;
  delete copy.incognito;
  delete copy.syncExcluded;
  return copy;
}

/**
 * A key that has never uploaded anything has no server row yet, so every GET
 * answers 404 until the first PUT auto-registers it. Treat that specific
 * response as "nothing stored", while letting auth and other HTTP errors
 * propagate.
 */
async function readRemoteOrEmpty<T>(
  read: () => Promise<T>,
  empty: T,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof SyncAuthError) throw error;
    if (error instanceof SyncHttpError && error.status === 404) return empty;
    throw error;
  }
}

/** Build a service bound to the given dependencies (production by default). */
export function createSyncService(
  overrides: Partial<SyncServiceDeps> = {},
): SyncService {
  const deps: SyncServiceDeps = { ...defaultDeps, ...overrides };

  /** Mark a local session for retry without advancing its `updatedAt`. */
  async function markPendingUpload(session: Session): Promise<void> {
    if (session.pendingUpload) return;
    await deps.repo.updateSession(session.id, {
      pendingUpload: true,
      updatedAt: session.updatedAt,
    });
  }

  /**
   * Delete local sessions for remote tombstones that are at least as new as
   * the local copy. The server's tombstone timestamp is preserved so a blob
   * updated after the deletion (but before "now") can still win the merge.
   * The repository write also records a local tombstone so a later blob
   * download cannot resurrect the session.
   */
  async function applyDeletions(
    deletions: readonly RemoteDeletion[],
  ): Promise<number> {
    if (deletions.length === 0) return 0;

    const localById = new Map<string, Session>(
      (await deps.repo.listSessions()).map(
        (session) => [session.id, session] as const,
      ),
    );

    let deleted = 0;
    for (const deletion of deletions) {
      const local = localById.get(deletion.id);
      if (local === undefined || deletion.deletedAt < local.updatedAt) continue;

      await deps.repo.deleteSession(deletion.id, deletion.deletedAt);
      localById.delete(deletion.id);
      deleted += 1;
    }
    return deleted;
  }

  /** Download and decrypt every remote blob, page by page. */
  async function downloadRemoteSessions(
    client: SyncClientApi,
    derived: DerivedKeys,
    result: SyncResult,
  ): Promise<Session[]> {
    const remote: Session[] = [];
    const seenPages = new Set<number>();
    let page = 0;

    for (;;) {
      if (seenPages.has(page)) {
        result.errors.push(
          `download: the server repeated blob page ${page}; stopped paging.`,
        );
        break;
      }
      seenPages.add(page);

      const response = await readRemoteOrEmpty<BlobPage>(
        () => client.listBlobs(page, BLOB_PAGE_SIZE),
        { blobs: [] },
      );

      for (const blob of response.blobs) {
        try {
          remote.push(
            await decryptSession(
              derived.encKey,
              derived.authId,
              blob.id,
              blob.ciphertext,
            ),
          );
        } catch (error) {
          result.errors.push(`download ${blob.id}: ${errorMessage(error)}`);
        }
      }

      if (response.nextPage === undefined) break;
      page = response.nextPage;
    }

    return remote;
  }

  /**
   * Merge remote sessions into the local store. Only entries the remote side
   * won (or supplied) are written, so an unchanged local session never churns
   * IndexedDB or emits a change broadcast.
   */
  async function persistMergedSessions(
    remote: readonly Session[],
    localTombstones: readonly Tombstone[],
    remoteDeletions: readonly RemoteDeletion[],
    now: number,
    result: SyncResult,
  ): Promise<void> {
    const local = await deps.repo.listSessions();
    const localById = new Map<string, Session>(
      local.map((session) => [session.id, session] as const),
    );
    const merged = mergeSessions(
      local,
      remote,
      [...localTombstones, ...remoteDeletions],
      now,
    );

    for (const session of merged) {
      // `mergeSessions` returns the original local object when the local copy
      // wins, so reference equality identifies remote additions/changes.
      if (localById.get(session.id) === session) continue;

      try {
        await deps.repo.addSession(session);
        result.downloaded += 1;
      } catch (error) {
        result.errors.push(`download ${session.id}: ${errorMessage(error)}`);
      }
    }
  }

  /** Upload local sessions that are missing, newer, or awaiting retry. */
  async function uploadLocalSessions(
    client: SyncClientApi,
    derived: DerivedKeys,
    summaries: readonly SessionSummary[],
    force: boolean,
    result: SyncResult,
  ): Promise<void> {
    const remoteById = new Map<string, SessionSummary>(
      summaries.map((summary) => [summary.id, summary] as const),
    );
    const local = await deps.repo.listSessions();

    for (const session of local) {
      // Incognito sessions and sessions excluded by a "skip upload" key
      // import must never reach the server, not even after a rebind that
      // force-uploads everything else.
      if (session.incognito || session.syncExcluded) continue;

      if (!force) {
        const remote = remoteById.get(session.id);
        const dirty =
          session.pendingUpload === true ||
          remote === undefined ||
          session.updatedAt > remote.updatedAt;
        if (!dirty) continue;
      }

      let ciphertext: string;
      try {
        ciphertext = await encryptSession(
          derived.encKey,
          derived.authId,
          toRemoteSession(session),
        );
      } catch (error) {
        result.errors.push(`upload ${session.id}: ${errorMessage(error)}`);
        continue;
      }

      const size = decodedByteLength(ciphertext);
      if (size > LIMITS.maxSessionBytes) {
        result.errors.push(
          `upload ${session.id}: the encrypted session is ${size} bytes and ` +
            `exceeds the ${LIMITS.maxSessionBytes}-byte sync limit; export or split it.`,
        );
        continue;
      }

      try {
        await client.put(session.id, ciphertext, session.updatedAt);
        result.uploaded += 1;

        if (session.pendingUpload === true) {
          await deps.repo.updateSession(session.id, {
            pendingUpload: false,
            updatedAt: session.updatedAt,
          });
        }
      } catch (error) {
        if (error instanceof SyncAuthError) throw error;
        result.errors.push(`upload ${session.id}: ${errorMessage(error)}`);
        await markPendingUpload(session);
      }
    }
  }

  /**
   * Push local tombstones the server does not know yet. A tombstone the server
   * already stores at least as recently is skipped: re-sending it would renew
   * its `deleted_at` and could suppress a newer remote edit. Local tombstones
   * stay in IndexedDB for the full 30-day window to block resurrection races;
   * only expired entries are left out here (the repository also prunes them).
   *
   * A 404 means the key has no server row yet (nothing to delete), so a fresh
   * key does not report a spurious error.
   */
  async function pushLocalTombstones(
    client: SyncClientApi,
    tombstones: readonly Tombstone[],
    remoteDeletions: readonly RemoteDeletion[],
    now: number,
    result: SyncResult,
  ): Promise<void> {
    const serverDeletedAt = new Map<string, number>();
    for (const deletion of remoteDeletions) {
      const known = serverDeletedAt.get(deletion.id);
      if (known === undefined || deletion.deletedAt > known) {
        serverDeletedAt.set(deletion.id, deletion.deletedAt);
      }
    }

    for (const tombstone of pruneTombstones(tombstones, now)) {
      const known = serverDeletedAt.get(tombstone.id);
      if (known !== undefined && known >= tombstone.deletedAt) continue;

      try {
        await client.delete(tombstone.id);
      } catch (error) {
        if (error instanceof SyncAuthError) throw error;
        if (error instanceof SyncHttpError && error.status === 404) continue;
        result.errors.push(`delete ${tombstone.id}: ${errorMessage(error)}`);
      }
    }
  }

  /**
   * Persist the "skip upload" decision from a key import: sessions that exist
   * right now are excluded from every future upload. Sessions created after
   * the import are unaffected and sync normally.
   */
  async function markLocalSessionsSyncExcluded(): Promise<void> {
    for (const session of await deps.repo.listSessions()) {
      if (session.incognito || session.syncExcluded) continue;
      await deps.repo.updateSession(session.id, {
        syncExcluded: true,
        updatedAt: session.updatedAt,
      });
    }
  }

  async function enqueueUpload(session: Session): Promise<void> {
    if (session.incognito) return;

    const settings = await deps.loadSettings();
    if (settings["sync.enabled"] !== true) return;

    const key = await deps.getKey();
    if (key === undefined) {
      // No key means nothing can be encrypted yet. Keep the work for the next
      // sync instead of failing the save flow.
      await markPendingUpload(session);
      return;
    }

    const derived = await deriveKeys(parseKey(key));
    const ciphertext = await encryptSession(
      derived.encKey,
      derived.authId,
      toRemoteSession(session),
    );

    const size = decodedByteLength(ciphertext);
    if (size > LIMITS.maxSessionBytes) {
      throw new Error(
        `Session "${session.id}" exceeds the ${LIMITS.maxSessionBytes}-byte ` +
          `sync limit (${size} bytes); export or split it before uploading.`,
      );
    }

    const client = deps.createClient(derived.authId, derived.authKey);
    try {
      await client.put(session.id, ciphertext, session.updatedAt);
    } catch (error) {
      if (error instanceof SyncAuthError) throw error;
      // A transient failure must not break saving; retry on the next sync.
      await markPendingUpload(session);
      return;
    }

    if (session.pendingUpload) {
      await deps.repo.updateSession(session.id, {
        pendingUpload: false,
        updatedAt: session.updatedAt,
      });
    }
  }

  async function syncNow(): Promise<SyncResult> {
    const result: SyncResult = {
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      errors: [],
    };

    const settings = await deps.loadSettings();
    if (settings["sync.enabled"] !== true) return result;

    const key = await deps.getKey();
    if (key === undefined) {
      // Surface this as an auth problem: a silent empty success would look
      // like "no sessions synced" and hide the misconfiguration.
      throw new SyncAuthError(
        "No sync key is configured. Create or import a sync key first.",
      );
    }

    const derived = await deriveKeys(parseKey(key));
    const client = deps.createClient(derived.authId, derived.authKey);
    const now = deps.now();

    // The initial reads decide whether this run is meaningful at all. A 401
    // must surface as SyncAuthError; every other failure is reported in the
    // partial result instead of throwing out of the UI handler.
    let summaries: SessionSummary[];
    let remoteDeletions: RemoteDeletion[];
    try {
      summaries = await readRemoteOrEmpty<SessionSummary[]>(
        () => client.listSummaries(),
        [],
      );
      remoteDeletions = await readRemoteOrEmpty<RemoteDeletion[]>(
        () => client.listDeletions(),
        [],
      );
    } catch (error) {
      if (error instanceof SyncAuthError) throw error;
      result.errors.push(errorMessage(error));
      return result;
    }

    // Consume the key-rebind decision before merging so "skip" marks only the
    // sessions that existed at import time, not copies downloaded in this run.
    const rebind = await deps.consumePendingRebind();
    let forceUpload = false;
    if (rebind === "skip") {
      await markLocalSessionsSyncExcluded();
    } else if (rebind === "upload") {
      forceUpload = true;
    }

    result.deleted = await applyDeletions(remoteDeletions);

    const localTombstones = await deps.repo.getTombstones();

    let remoteSessions: Session[];
    try {
      remoteSessions = await downloadRemoteSessions(client, derived, result);
    } catch (error) {
      if (error instanceof SyncAuthError) throw error;
      result.errors.push(errorMessage(error));
      return result;
    }

    await persistMergedSessions(
      remoteSessions,
      localTombstones,
      remoteDeletions,
      now,
      result,
    );

    await uploadLocalSessions(client, derived, summaries, forceUpload, result);
    await pushLocalTombstones(
      client,
      localTombstones,
      remoteDeletions,
      now,
      result,
    );

    return result;
  }

  async function applyRemoteDeletions(
    deletions: readonly RemoteDeletion[],
  ): Promise<number> {
    return applyDeletions(deletions);
  }

  return { enqueueUpload, syncNow, applyRemoteDeletions };
}

let defaultService: SyncService | null = null;

function getDefaultService(): SyncService {
  defaultService ??= createSyncService();
  return defaultService;
}

/**
 * Encrypt and upload one freshly saved session. Incognito sessions are a
 * no-op, oversized sessions throw an error containing "exceeds", and network
 * failures mark the session `pendingUpload` without throwing.
 */
export function enqueueUpload(session: Session): Promise<void> {
  return getDefaultService().enqueueUpload(session);
}

/**
 * Run a full two-way sync. Returns counters plus per-item error messages.
 * `SyncAuthError` always propagates so the UI can show an auth problem; other
 * whole-run read failures are reported in `errors` and return the partial
 * result instead of throwing.
 */
export function syncNow(): Promise<SyncResult> {
  return getDefaultService().syncNow();
}

/** Apply remote tombstones to the local store; returns how many were deleted. */
export function applyRemoteDeletions(
  deletions: readonly RemoteDeletion[],
): Promise<number> {
  return getDefaultService().applyRemoteDeletions(deletions);
}
