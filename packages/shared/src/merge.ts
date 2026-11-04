import type { Session } from "./types";

/** Record that a session was deleted, kept so other devices cannot resurrect it. */
export type Tombstone = {
  id: string;
  /** epoch ms */
  deletedAt: number;
};

/**
 * Tombstones live for 30 days, matching the server's `deletions` retention.
 * After that a deletion is forgotten and a stale device may upload the session
 * again; the server/client merge accepts that as the best available outcome.
 */
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Drops tombstones that are at least 30 days old at `now`.
 * The input array is not mutated.
 */
export function pruneTombstones(
  tombstones: readonly Tombstone[],
  now: number,
): Tombstone[] {
  return tombstones.filter((tombstone) => now - tombstone.deletedAt < TOMBSTONE_TTL_MS);
}

/**
 * Merges local and remote sessions by `session.id`.
 *
 * - Last-write-wins: the session with the newer `updatedAt` is kept. A tie is
 *   resolved in favour of the local copy, so a merge is idempotent and never
 *   replaces local content with an equally old remote copy.
 * - Sessions present on only one side are kept.
 * - A tombstone deletes a session when `deletedAt >= updatedAt`; deletion wins
 *   ties. Expired tombstones are pruned first so they cannot block forever.
 * - Order is stable: sessions keep their position from the local list, and
 *   remote-only sessions are appended in remote order. Callers that display a
 *   list sort for presentation (for example by `updatedAt`).
 *
 * Neither the session arrays nor the tombstone array are mutated.
 */
export function mergeSessions(
  local: readonly Session[],
  remote: readonly Session[],
  tombstones: readonly Tombstone[],
  now: number,
): Session[] {
  const byId = new Map<string, Session>();
  for (const session of local) {
    byId.set(session.id, session);
  }
  for (const session of remote) {
    const current = byId.get(session.id);
    if (!current || session.updatedAt > current.updatedAt) {
      byId.set(session.id, session);
    }
  }

  // Keep the latest deletion per session; tombstones may be duplicated when the
  // same deletion is known locally and fetched from the server.
  const deletedAtById = new Map<string, number>();
  for (const tombstone of pruneTombstones(tombstones, now)) {
    const known = deletedAtById.get(tombstone.id);
    if (known === undefined || tombstone.deletedAt > known) {
      deletedAtById.set(tombstone.id, tombstone.deletedAt);
    }
  }

  const merged: Session[] = [];
  for (const [id, session] of byId) {
    const deletedAt = deletedAtById.get(id);
    if (deletedAt !== undefined && deletedAt >= session.updatedAt) continue;
    merged.push(session);
  }
  return merged;
}
