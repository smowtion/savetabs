import { LIMITS, type SavedTab, type Session } from "@savetabs/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import {
  SESSIONS_DB_NAME,
  SESSIONS_DB_VERSION,
  SESSIONS_STORE_NAME,
  TOMBSTONE_STORE_NAME,
  UPDATED_AT_INDEX_NAME,
  closeSessionsDb,
  openSessionsDb,
} from "./sessions-db";
import {
  LocalQuotaError,
  SESSIONS_CHANNEL_NAME,
  SESSIONS_REVISION_KEY,
  addSession,
  broadcastSessionsChanged,
  deleteSession,
  getSession,
  getTombstones,
  getUsage,
  listSessions,
  onSessionsChanged,
  updateSession,
} from "./sessions-repo";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOMBSTONE_TTL_MS = 30 * DAY_MS;
const SESSION_WARN_COUNT = Math.ceil(LIMITS.maxLocalSessions * 0.9);
const TAB_WARN_COUNT = Math.ceil(LIMITS.maxLocalTabs * 0.9);

let sessionCounter = 0;

function makeSession(overrides: Partial<Session> = {}): Session {
  sessionCounter += 1;
  const createdAt = overrides.createdAt ?? 1_000 + sessionCounter;
  return {
    id: `session-${sessionCounter}`,
    createdAt,
    updatedAt: createdAt,
    source: "window",
    tabs: [{ url: "https://example.com", title: "Example" }],
    ...overrides,
  };
}

function makeTabs(count: number): SavedTab[] {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://example.com/${index}`,
    title: `Tab ${index}`,
  }));
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

/** Seeds sessions directly through the database layer, bypassing `addSession`. */
async function seedSessions(sessions: readonly Session[]): Promise<void> {
  const database = await openSessionsDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      SESSIONS_STORE_NAME,
      "readwrite",
    );
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("seed failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("seed aborted"));
    const store = transaction.objectStore(SESSIONS_STORE_NAME);
    for (const session of sessions) store.put(session);
  });
}

/** Waits for an async condition by polling a fixed number of times. */
function waitFor(condition: () => boolean, attempts = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    const tick = (remaining: number) => {
      if (condition()) {
        resolve();
        return;
      }
      if (remaining <= 0) {
        reject(new Error("condition was not met in time"));
        return;
      }
      setTimeout(() => tick(remaining - 1), 5);
    };
    tick(attempts);
  });
}

function nextChannelMessage(channel: BroadcastChannel): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.removeEventListener("message", onMessage);
      reject(new Error("no BroadcastChannel message received"));
    }, 1_000);
    function onMessage(event: MessageEvent): void {
      clearTimeout(timer);
      channel.removeEventListener("message", onMessage);
      resolve(event.data);
    }
    channel.addEventListener("message", onMessage);
  });
}

async function readRevision(): Promise<unknown> {
  const stored = await fakeBrowser.storage.local.get(SESSIONS_REVISION_KEY);
  return stored[SESSIONS_REVISION_KEY];
}

beforeEach(async () => {
  fakeBrowser.reset();
  await closeSessionsDb();
  await deleteDatabase();
  sessionCounter = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeSessionsDb();
});

describe("database schema", () => {
  it("creates the savetabs database with the documented stores and index", async () => {
    const database = await openSessionsDb();

    expect(database.name).toBe("savetabs");
    expect(database.version).toBe(SESSIONS_DB_VERSION);
    expect(Array.from(database.objectStoreNames).sort()).toEqual([
      "sessions",
      "tombstones",
    ]);

    const sessionStore = database
      .transaction(SESSIONS_STORE_NAME, "readonly")
      .objectStore(SESSIONS_STORE_NAME);
    expect(sessionStore.keyPath).toBe("id");
    expect(Array.from(sessionStore.indexNames)).toEqual(["updatedAt"]);
    expect(sessionStore.index(UPDATED_AT_INDEX_NAME).keyPath).toBe("updatedAt");

    const tombstoneStore = database
      .transaction(TOMBSTONE_STORE_NAME, "readonly")
      .objectStore(TOMBSTONE_STORE_NAME);
    expect(tombstoneStore.keyPath).toBe("id");
  });
});

describe("listSessions", () => {
  it("returns sessions newest-first by updatedAt", async () => {
    await addSession(
      makeSession({ id: "oldest", createdAt: 1, updatedAt: 10 }),
    );
    await addSession(
      makeSession({ id: "newest", createdAt: 2, updatedAt: 30 }),
    );
    await addSession(
      makeSession({ id: "middle", createdAt: 3, updatedAt: 20 }),
    );

    const sessions = await listSessions();
    expect(sessions.map((session) => session.id)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("breaks updatedAt ties by createdAt, then by id", async () => {
    await addSession(
      makeSession({ id: "older-created", createdAt: 10, updatedAt: 100 }),
    );
    await addSession(
      makeSession({ id: "b-same-created", createdAt: 20, updatedAt: 100 }),
    );
    await addSession(
      makeSession({ id: "a-same-created", createdAt: 20, updatedAt: 100 }),
    );
    await addSession(
      makeSession({ id: "newer-created", createdAt: 30, updatedAt: 100 }),
    );

    const sessions = await listSessions();
    expect(sessions.map((session) => session.id)).toEqual([
      "newer-created",
      "a-same-created",
      "b-same-created",
      "older-created",
    ]);
  });

  it("returns an empty list when nothing has been saved", async () => {
    await expect(listSessions()).resolves.toEqual([]);
  });
});

describe("addSession and getSession", () => {
  it("stores and returns a session", async () => {
    const session = makeSession();

    await expect(addSession(session)).resolves.toEqual(session);
    await expect(getSession(session.id)).resolves.toEqual(session);
  });

  it("returns undefined for an unknown session", async () => {
    await expect(getSession("missing")).resolves.toBeUndefined();
  });
});

describe("updateSession", () => {
  it("merges the patch and bumps updatedAt when the patch omits it", async () => {
    const session = makeSession({ createdAt: 100, updatedAt: 200 });
    await addSession(session);
    vi.spyOn(Date, "now").mockReturnValue(5_000);

    const updated = await updateSession(session.id, { title: "Renamed" });

    expect(updated).toMatchObject({
      id: session.id,
      createdAt: 100,
      updatedAt: 5_000,
      title: "Renamed",
      source: "window",
    });
    expect(updated?.tabs).toEqual(session.tabs);
    await expect(getSession(session.id)).resolves.toEqual(updated);
  });

  it("keeps an updatedAt supplied in the patch", async () => {
    const session = makeSession({ updatedAt: 200 });
    await addSession(session);
    vi.spyOn(Date, "now").mockReturnValue(5_000);

    const updated = await updateSession(session.id, {
      title: "Renamed",
      updatedAt: 777,
    });

    expect(updated?.updatedAt).toBe(777);
  });

  it("returns undefined and writes nothing for an unknown session", async () => {
    await expect(
      updateSession("missing", { title: "Renamed" }),
    ).resolves.toBeUndefined();
    await expect(listSessions()).resolves.toEqual([]);
  });
});

describe("deleteSession and getTombstones", () => {
  it("removes the session and records a tombstone", async () => {
    const keep = makeSession();
    const remove = makeSession();
    await addSession(keep);
    await addSession(remove);

    await deleteSession(remove.id, 12_345);

    await expect(getSession(remove.id)).resolves.toBeUndefined();
    expect((await listSessions()).map((session) => session.id)).toEqual([
      keep.id,
    ]);
    await expect(getTombstones()).resolves.toEqual([
      { id: remove.id, deletedAt: 12_345 },
    ]);
  });

  it("records a tombstone even when the session is already gone", async () => {
    await deleteSession("missing", 99);

    await expect(getTombstones()).resolves.toEqual([
      { id: "missing", deletedAt: 99 },
    ]);
  });

  it("prunes tombstones that are at least 30 days old when deleting", async () => {
    await deleteSession("old", 0);

    await deleteSession("recent", TOMBSTONE_TTL_MS);

    await expect(getTombstones()).resolves.toEqual([
      { id: "recent", deletedAt: TOMBSTONE_TTL_MS },
    ]);
  });

  it("prunes expired tombstones when the database is reopened", async () => {
    await deleteSession("old", 0);
    expect(await getTombstones()).toHaveLength(1);

    await closeSessionsDb();
    vi.spyOn(Date, "now").mockReturnValue(TOMBSTONE_TTL_MS);

    await expect(getTombstones()).resolves.toEqual([]);
  });
});

describe("local caps", () => {
  it("allows the session that reaches the session cap exactly", async () => {
    await seedSessions(
      Array.from({ length: LIMITS.maxLocalSessions - 1 }, (_, index) =>
        makeSession({ id: `seed-${index}`, tabs: [] }),
      ),
    );

    await addSession(makeSession({ id: "last-allowed", tabs: [] }));

    await expect(getUsage()).resolves.toMatchObject({
      sessions: LIMITS.maxLocalSessions,
    });
  });

  it("throws LocalQuotaError at the session cap without writing", async () => {
    await seedSessions(
      Array.from({ length: LIMITS.maxLocalSessions }, (_, index) =>
        makeSession({ id: `seed-${index}`, tabs: [] }),
      ),
    );

    const error = await addSession(
      makeSession({ id: "overflow", tabs: [] }),
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(LocalQuotaError);
    expect(error).toMatchObject({
      name: "LocalQuotaError",
      resource: "sessions",
      limit: LIMITS.maxLocalSessions,
    });
    await expect(getSession("overflow")).resolves.toBeUndefined();
    await expect(getUsage()).resolves.toMatchObject({
      sessions: LIMITS.maxLocalSessions,
    });
  });

  it("throws LocalQuotaError when the tab cap would be exceeded", async () => {
    await seedSessions([
      makeSession({ id: "near-tab-cap", tabs: makeTabs(LIMITS.maxLocalTabs - 1) }),
    ]);

    await addSession(
      makeSession({ id: "reaches-tab-cap", tabs: makeTabs(1) }),
    );
    await expect(getUsage()).resolves.toMatchObject({
      tabs: LIMITS.maxLocalTabs,
    });

    const error = await addSession(
      makeSession({ id: "over-tab-cap", tabs: makeTabs(1) }),
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(LocalQuotaError);
    expect(error).toMatchObject({
      name: "LocalQuotaError",
      resource: "tabs",
      limit: LIMITS.maxLocalTabs,
    });
    await expect(getSession("over-tab-cap")).resolves.toBeUndefined();
    await expect(getUsage()).resolves.toMatchObject({
      tabs: LIMITS.maxLocalTabs,
    });
  });
});

describe("getUsage", () => {
  it("reports empty usage", async () => {
    await expect(getUsage()).resolves.toEqual({
      sessions: 0,
      tabs: 0,
      nearLimit: false,
    });
  });

  it("flags the 90% threshold for sessions and tabs", async () => {
    await seedSessions(
      Array.from({ length: SESSION_WARN_COUNT - 1 }, (_, index) =>
        makeSession({ id: `seed-${index}`, tabs: [] }),
      ),
    );
    await expect(getUsage()).resolves.toMatchObject({
      sessions: SESSION_WARN_COUNT - 1,
      nearLimit: false,
    });

    await addSession(makeSession({ id: "session-warn", tabs: [] }));
    await expect(getUsage()).resolves.toMatchObject({
      sessions: SESSION_WARN_COUNT,
      nearLimit: true,
    });

    await closeSessionsDb();
    await deleteDatabase();
    await seedSessions([
      makeSession({ id: "tabs-below", tabs: makeTabs(TAB_WARN_COUNT - 1) }),
    ]);
    await expect(getUsage()).resolves.toMatchObject({
      tabs: TAB_WARN_COUNT - 1,
      nearLimit: false,
    });

    await addSession(makeSession({ id: "tabs-warn", tabs: makeTabs(1) }));
    await expect(getUsage()).resolves.toMatchObject({
      tabs: TAB_WARN_COUNT,
      nearLimit: true,
    });
  });
});

describe("change notification", () => {
  it("broadcastSessionsChanged posts a sessions-changed event", async () => {
    const watcher = new BroadcastChannel(SESSIONS_CHANNEL_NAME);
    try {
      const message = nextChannelMessage(watcher);
      broadcastSessionsChanged();
      await expect(message).resolves.toEqual({ type: "sessions-changed" });
    } finally {
      watcher.close();
    }
  });

  it("writes a revision and broadcasts after every mutation", async () => {
    let clock = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock++);
    const watcher = new BroadcastChannel(SESSIONS_CHANNEL_NAME);
    const session = makeSession();

    try {
      let message = nextChannelMessage(watcher);
      await addSession(session);
      await expect(message).resolves.toEqual({ type: "sessions-changed" });
      const revisionAfterAdd = await readRevision();
      expect(typeof revisionAfterAdd).toBe("number");

      message = nextChannelMessage(watcher);
      await updateSession(session.id, { title: "Renamed" });
      await expect(message).resolves.toEqual({ type: "sessions-changed" });
      const revisionAfterUpdate = await readRevision();
      expect(revisionAfterUpdate).toBeGreaterThan(
        revisionAfterAdd as number,
      );

      message = nextChannelMessage(watcher);
      await deleteSession(session.id);
      await expect(message).resolves.toEqual({ type: "sessions-changed" });
      const revisionAfterDelete = await readRevision();
      expect(revisionAfterDelete).toBeGreaterThan(
        revisionAfterUpdate as number,
      );
    } finally {
      watcher.close();
    }
  });

  it("notifies subscribers about storage revisions from other contexts", async () => {
    const calls: number[] = [];
    const unsubscribe = onSessionsChanged(() => calls.push(1));

    await fakeBrowser.storage.local.set({ unrelated: true });
    await fakeBrowser.storage.local.set({ [SESSIONS_REVISION_KEY]: 1 });
    expect(calls).toHaveLength(1);

    unsubscribe();
    await fakeBrowser.storage.local.set({ [SESSIONS_REVISION_KEY]: 2 });
    expect(calls).toHaveLength(1);
  });

  it("notifies subscribers about BroadcastChannel messages", async () => {
    const calls: number[] = [];
    const unsubscribe = onSessionsChanged(() => calls.push(1));
    const sender = new BroadcastChannel(SESSIONS_CHANNEL_NAME);

    try {
      sender.postMessage({ type: "sessions-changed" });
      await waitFor(() => calls.length === 1);
      expect(calls).toHaveLength(1);

      sender.postMessage({ type: "unrelated" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toHaveLength(1);

      unsubscribe();
      sender.postMessage({ type: "sessions-changed" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toHaveLength(1);
    } finally {
      sender.close();
    }
  });

  it("notifies subscribers when a session is mutated", async () => {
    const calls: number[] = [];
    const unsubscribe = onSessionsChanged(() => calls.push(1));

    try {
      await addSession(makeSession());
      await waitFor(() => calls.length >= 1);
      expect(calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      unsubscribe();
    }
  });
});
