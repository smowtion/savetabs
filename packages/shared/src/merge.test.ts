import { describe, it, expect } from "vitest";
import { mergeSessions, pruneTombstones } from "./merge";
import type { Session } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Builds a session with sensible defaults; only id and updatedAt matter here. */
function session(overrides: Partial<Session> & Pick<Session, "id" | "updatedAt">): Session {
  return {
    createdAt: overrides.updatedAt,
    source: "window",
    tabs: [],
    ...overrides,
  };
}

it("newer wins, remote-only added, tombstones block resurrection", () => {
  const local: Session[] = [{ id: "a", updatedAt: 2, createdAt: 1, source: "window", tabs: [] }];
  const remote: Session[] = [
    { id: "a", updatedAt: 1, createdAt: 1, source: "window", tabs: [] },
    { id: "b", updatedAt: 3, createdAt: 3, source: "window", tabs: [] },
    { id: "c", updatedAt: 4, createdAt: 4, source: "window", tabs: [] },
  ];
  const merged = mergeSessions(local, remote, [{ id: "c", deletedAt: 10 }], 20);
  expect(merged.map(s => s.id)).toEqual(["a", "b"]);
});

it("remote tombstone removes local session older than it", () => {
  const local: Session[] = [{ id: "x", updatedAt: 5, createdAt: 5, source: "window", tabs: [] }];
  expect(mergeSessions(local, [], [{ id: "x", deletedAt: 6 }], 20)).toEqual([]);
});

it("keeps the locally newer session and takes the remotely newer one", () => {
  const localLo: Session = session({ id: "a", updatedAt: 5, tabs: [{ url: "https://local", title: "local" }] });
  const remoteOld: Session = session({ id: "a", updatedAt: 4, tabs: [{ url: "https://remote", title: "remote" }] });
  expect(mergeSessions([localLo], [remoteOld], [], 0)).toEqual([localLo]);

  const localOld: Session = session({ id: "b", updatedAt: 4, tabs: [{ url: "https://local", title: "local" }] });
  const remoteNew: Session = session({ id: "b", updatedAt: 5, tabs: [{ url: "https://remote", title: "remote" }] });
  expect(mergeSessions([localOld], [remoteNew], [], 0)).toEqual([remoteNew]);
});

it("keeps the local session when both sides share an updatedAt", () => {
  const localSame: Session = session({ id: "a", updatedAt: 5, tabs: [{ url: "https://local", title: "local" }] });
  const remoteSame: Session = session({ id: "a", updatedAt: 5, tabs: [{ url: "https://remote", title: "remote" }] });
  expect(mergeSessions([localSame], [remoteSame], [], 0)).toEqual([localSame]);
});

it("deletion wins a tie between deletedAt and updatedAt", () => {
  const local = [session({ id: "a", updatedAt: 5 })];
  expect(mergeSessions(local, [], [{ id: "a", deletedAt: 5 }], 5)).toEqual([]);
});

it("an older tombstone does not remove a newer session", () => {
  const local = [session({ id: "a", updatedAt: 6 })];
  expect(mergeSessions(local, [], [{ id: "a", deletedAt: 5 }], 6)).toEqual([local[0]]);
});

it("removes remote-only sessions that have a tombstone", () => {
  const remote = [session({ id: "b", updatedAt: 3 })];
  expect(mergeSessions([], remote, [{ id: "b", deletedAt: 3 }], 3)).toEqual([]);
});

it("uses the newest of several tombstones for the same session", () => {
  const local = [session({ id: "a", updatedAt: 5 })];
  const tombstones = [
    { id: "a", deletedAt: 1 },
    { id: "a", deletedAt: 7 },
  ];
  expect(mergeSessions(local, [], tombstones, 7)).toEqual([]);
});

it("does not let an expired tombstone block a session", () => {
  const local = [session({ id: "a", updatedAt: 5 })];
  const deletedAt = 100;
  const now = deletedAt + 30 * DAY_MS;
  expect(mergeSessions(local, [], [{ id: "a", deletedAt }], now)).toEqual([local[0]]);
});

it("prunes tombstones at the 30-day boundary and keeps newer ones", () => {
  const deletedAt = 100;
  const tombstones = [{ id: "a", deletedAt }];
  expect(pruneTombstones(tombstones, deletedAt + 30 * DAY_MS - 1)).toEqual(tombstones);
  expect(pruneTombstones(tombstones, deletedAt + 30 * DAY_MS)).toEqual([]);
});

it("does not mutate its inputs", () => {
  const local = [session({ id: "a", updatedAt: 5 }), session({ id: "b", updatedAt: 2 })];
  const remote = [session({ id: "b", updatedAt: 3 }), session({ id: "c", updatedAt: 4 })];
  const tombstones = [{ id: "c", deletedAt: 4 }];
  const localSnapshot = structuredClone(local);
  const remoteSnapshot = structuredClone(remote);
  const tombstonesSnapshot = structuredClone(tombstones);

  mergeSessions(local, remote, tombstones, 10);
  pruneTombstones(tombstones, 10);

  expect(local).toEqual(localSnapshot);
  expect(remote).toEqual(remoteSnapshot);
  expect(tombstones).toEqual(tombstonesSnapshot);
});
