import { webcrypto } from "node:crypto";

import {
  LIMITS,
  SyncAuthError,
  SyncClient,
  SyncHttpError,
  decryptSession,
  deriveKeys,
  encryptSession,
  generateKey,
  parseKey,
  type DerivedKeys,
  type RemoteDeletion,
  type RemoteSessionBlob,
  type Session,
  type SessionSummary,
  type Settings,
  type Tombstone,
} from "@savetabs/shared";
import { describe, expect, it, vi } from "vitest";

import type { SessionPatch } from "../sessions-repo";
import {
  createSyncService,
  type SyncClientApi,
  type SyncRepository,
} from "./sync-service";

// jsdom ships a Crypto object without SubtleCrypto; the real crypto primitives
// are the ones under test, so fall back to Node's WebCrypto implementation.
if (typeof globalThis.crypto?.subtle === "undefined") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const KEY = generateKey();

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-a",
    createdAt: NOW - 60_000,
    updatedAt: NOW - 1_000,
    source: "window",
    tabs: [{ url: "https://example.com/a", title: "Example A" }],
    ...overrides,
  };
}

async function deriveTestKeys(): Promise<DerivedKeys> {
  return deriveKeys(parseKey(KEY));
}

async function encryptedBlob(
  session: Session,
  derived: DerivedKeys,
): Promise<RemoteSessionBlob> {
  return {
    id: session.id,
    updatedAt: session.updatedAt,
    ciphertext: await encryptSession(derived.encKey, derived.authId, session),
  };
}

/** In-memory stand-in for the IndexedDB repository. */
class FakeRepo implements SyncRepository {
  readonly sessions = new Map<string, Session>();
  readonly tombstones = new Map<string, Tombstone>();
  readonly patches: Array<{ id: string; patch: SessionPatch }> = [];
  readonly deletes: Array<{ id: string; now: number | undefined }> = [];

  seed(...sessions: Session[]): void {
    for (const session of sessions) this.sessions.set(session.id, session);
  }

  async listSessions(): Promise<Session[]> {
    return [...this.sessions.values()].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
  }

  async getTombstones(): Promise<Tombstone[]> {
    return [...this.tombstones.values()];
  }

  async addSession(session: Session): Promise<Session> {
    this.sessions.set(session.id, session);
    return session;
  }

  async updateSession(
    id: string,
    patch: SessionPatch,
  ): Promise<Session | undefined> {
    this.patches.push({ id, patch });
    const current = this.sessions.get(id);
    if (current === undefined) return undefined;

    const next: Session = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: patch.updatedAt ?? Date.now(),
    };
    this.sessions.set(id, next);
    return next;
  }

  async deleteSession(id: string, now: number = Date.now()): Promise<void> {
    this.deletes.push({ id, now });
    this.sessions.delete(id);
    this.tombstones.set(id, { id, deletedAt: now });
  }
}

/** In-memory stand-in for the network client. */
class FakeClient implements SyncClientApi {
  summaries: SessionSummary[] = [];
  deletions: RemoteDeletion[] = [];
  pages: RemoteSessionBlob[][] = [];
  puts: Array<{ id: string; ciphertext: string; updatedAt: number }> = [];
  deletedIds: string[] = [];
  blobPageRequests: number[] = [];
  putError: unknown = null;
  deleteError: unknown = null;
  summariesError: unknown = null;
  deletionsError: unknown = null;
  blobsError: unknown = null;

  async listSummaries(): Promise<SessionSummary[]> {
    if (this.summariesError !== null) throw this.summariesError;
    return this.summaries;
  }

  async listDeletions(): Promise<RemoteDeletion[]> {
    if (this.deletionsError !== null) throw this.deletionsError;
    return this.deletions;
  }

  async listBlobs(
    page = 0,
    _pageSize = 50,
  ): Promise<{ blobs: RemoteSessionBlob[]; nextPage?: number }> {
    this.blobPageRequests.push(page);
    if (this.blobsError !== null) throw this.blobsError;

    const blobs = this.pages[page] ?? [];
    const nextPage = page + 1 < this.pages.length ? page + 1 : undefined;
    return nextPage === undefined ? { blobs } : { blobs, nextPage };
  }

  async put(id: string, ciphertext: string, updatedAt: number): Promise<void> {
    if (this.putError !== null) throw this.putError;
    this.puts.push({ id, ciphertext, updatedAt });
  }

  async delete(id: string): Promise<void> {
    if (this.deleteError !== null) throw this.deleteError;
    this.deletedIds.push(id);
  }
}

type HarnessOptions = {
  enabled?: boolean;
  key?: string | undefined;
  rebind?: "upload" | "skip";
  repo?: FakeRepo;
  client?: FakeClient;
  createClient?: (authId: string, authKey: string) => SyncClientApi;
  now?: number;
};

async function createHarness(options: HarnessOptions = {}) {
  const repo = options.repo ?? new FakeRepo();
  const client = options.client ?? new FakeClient();
  const createClient = vi.fn(
    options.createClient ?? ((_authId: string, _authKey: string) => client),
  );
  // Like the real key store, a pending rebind decision is consumed once.
  let rebind = options.rebind;
  const consumePendingRebind = vi.fn(async () => {
    const pending = rebind;
    rebind = undefined;
    return pending;
  });
  const peekPendingRebind = vi.fn(async () => rebind);
  const service = createSyncService({
    repo,
    getKey: async () => ("key" in options ? options.key : KEY),
    consumePendingRebind,
    peekPendingRebind,
    loadSettings: async () =>
      ({ "sync.enabled": options.enabled ?? true }) as Settings,
    createClient,
    now: () => options.now ?? NOW,
  });

  return {
    repo,
    client,
    createClient,
    service,
    consumePendingRebind,
    peekPendingRebind,
    pendingRebind: () => rebind,
    derived: await deriveTestKeys(),
  };
}

describe("enqueueUpload", () => {
  it("never uploads incognito sessions", async () => {
    const { client, createClient, repo, service } = await createHarness();

    await service.enqueueUpload(makeSession({ incognito: true, pendingUpload: true }));

    expect(createClient).not.toHaveBeenCalled();
    expect(client.puts).toEqual([]);
    expect(repo.patches).toEqual([]);
  });

  it("blocks oversized sessions before any upload", async () => {
    const { client, service } = await createHarness();
    const oversized = makeSession({
      tabs: [
        {
          url: "https://example.com/a",
          title: "x".repeat(LIMITS.maxSessionBytes + 1),
        },
      ],
    });

    await expect(service.enqueueUpload(oversized)).rejects.toThrow(/exceeds/);
    expect(client.puts).toEqual([]);
  });

  it("encrypts with the stored key and clears pendingUpload", async () => {
    const { client, derived, repo, service } = await createHarness();
    const session = makeSession({
      id: "session-1",
      updatedAt: NOW - 5,
      pendingUpload: true,
    });
    repo.seed(session);

    await service.enqueueUpload(session);

    expect(client.puts).toHaveLength(1);
    const upload = client.puts[0]!;
    expect(upload.id).toBe("session-1");
    expect(upload.updatedAt).toBe(session.updatedAt);

    const decrypted = await decryptSession(
      derived.encKey,
      derived.authId,
      "session-1",
      upload.ciphertext,
    );
    const { pendingUpload: _pendingUpload, ...expected } = session;
    expect(decrypted).toEqual(expected);
    expect(decrypted).not.toHaveProperty("pendingUpload");
    expect(repo.sessions.get("session-1")).toMatchObject({
      pendingUpload: false,
      updatedAt: session.updatedAt,
    });
  });

  it("never uploads a session excluded by a key import", async () => {
    const { client, createClient, repo, service } = await createHarness();
    const session = makeSession({ id: "session-1", syncExcluded: true });
    repo.seed(session);

    await service.enqueueUpload(session);

    expect(createClient).not.toHaveBeenCalled();
    expect(client.puts).toEqual([]);
    expect(repo.patches).toEqual([]);
  });

  it("marks a session pendingUpload when the network fails", async () => {
    const { client, repo, service } = await createHarness();
    const session = makeSession({ id: "session-1", updatedAt: NOW - 5 });
    repo.seed(session);
    client.putError = new Error("network down");

    await expect(service.enqueueUpload(session)).resolves.toBeUndefined();

    expect(repo.sessions.get("session-1")).toMatchObject({
      pendingUpload: true,
      updatedAt: session.updatedAt,
    });
  });

  it("rethrows auth failures without marking the session", async () => {
    const { client, repo, service } = await createHarness();
    const session = makeSession({ id: "session-1" });
    repo.seed(session);
    client.putError = new SyncAuthError("wrong key");

    await expect(service.enqueueUpload(session)).rejects.toBeInstanceOf(
      SyncAuthError,
    );
    expect(repo.sessions.get("session-1")?.pendingUpload).toBeUndefined();
  });

  it("does not upload while sync is disabled", async () => {
    const { createClient, service } = await createHarness({ enabled: false });

    await service.enqueueUpload(makeSession());

    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("syncNow", () => {
  it("returns zeros without touching the network when sync is disabled", async () => {
    const { createClient, service } = await createHarness({ enabled: false });

    await expect(service.syncNow()).resolves.toEqual({
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      errors: [],
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("fails loudly when sync is enabled but no key is stored", async () => {
    const { createClient, service } = await createHarness({ key: undefined });

    await expect(service.syncNow()).rejects.toBeInstanceOf(SyncAuthError);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("surfaces a 401 as SyncAuthError instead of an empty result", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { code: "unauthorized", message: "Wrong key." } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { service } = await createHarness({
      createClient: (authId, authKey) =>
        new SyncClient("https://api.savetabs.test", authId, authKey, fetchMock),
    });

    await expect(service.syncNow()).rejects.toBeInstanceOf(SyncAuthError);
  });

  it("treats the 404 of an unregistered key as empty remote state", async () => {
    const { client, repo, service } = await createHarness();
    repo.seed(makeSession({ id: "session-1" }));
    const notFound = new SyncHttpError(404, "not_found", "Sync key not found.");
    client.summariesError = notFound;
    client.deletionsError = notFound;
    client.blobsError = notFound;

    const result = await service.syncNow();

    expect(result).toMatchObject({
      uploaded: 1,
      downloaded: 0,
      deleted: 0,
      errors: [],
    });
    expect(client.puts.map((put) => put.id)).toEqual(["session-1"]);
  });

  it("returns errors instead of throwing when the initial read fails", async () => {
    const { client, repo, service } = await createHarness();
    repo.seed(makeSession({ id: "session-1" }));
    client.summariesError = new Error("offline");

    const result = await service.syncNow();

    expect(result).toEqual({
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      errors: ["offline"],
    });
    expect(client.puts).toEqual([]);
  });

  it("returns partial counts when blob paging fails", async () => {
    const { client, repo, service } = await createHarness();
    repo.seed(
      makeSession({ id: "deleted", updatedAt: 5 }),
      makeSession({ id: "local", updatedAt: 9 }),
    );
    client.deletions = [{ id: "deleted", deletedAt: 6 }];
    client.blobsError = new SyncHttpError(500, "internal_error", "server error");

    const result = await service.syncNow();

    expect(result).toMatchObject({
      uploaded: 0,
      downloaded: 0,
      deleted: 1,
    });
    expect(result.errors).toEqual(["server error"]);
    expect(client.puts).toEqual([]);
  });

  it("skips uploads and tombstone pushes when allowUpload is false", async () => {
    const { client, derived, repo, service } = await createHarness();
    repo.seed(makeSession({ id: "local", updatedAt: 100 }));
    repo.tombstones.set("deleted", { id: "deleted", deletedAt: NOW - DAY_MS });
    const remote = makeSession({ id: "remote", updatedAt: 50 });
    client.pages = [[await encryptedBlob(remote, derived)]];

    const result = await service.syncNow({ allowUpload: false });

    expect(result).toMatchObject({ uploaded: 0, downloaded: 1, deleted: 0 });
    expect(result.errors).toEqual([]);
    expect(client.puts).toEqual([]);
    expect(client.deletedIds).toEqual([]);
    // The remote copy still merged into the local store.
    expect(repo.sessions.get("remote")).toBeDefined();
    expect(repo.sessions.get("local")).toMatchObject({ updatedAt: 100 });
  });

  it("keeps an upload rebind pending when the download phase fails", async () => {
    const { client, repo, service, pendingRebind } = await createHarness({
      rebind: "upload",
    });
    repo.seed(makeSession({ id: "local", updatedAt: 100 }));
    client.blobsError = new SyncHttpError(500, "internal_error", "server error");

    const first = await service.syncNow();

    expect(first.errors).toHaveLength(1);
    // The force-upload promise survives for the next successful run.
    expect(pendingRebind()).toBe("upload");

    client.blobsError = null;
    const second = await service.syncNow();

    expect(second.uploaded).toBe(1);
    expect(client.puts.map((put) => put.id)).toEqual(["local"]);
    expect(pendingRebind()).toBeUndefined();
  });

  it("leaves an upload rebind pending when uploads are disallowed", async () => {
    const { client, repo, service, pendingRebind } = await createHarness({
      rebind: "upload",
    });
    repo.seed(makeSession({ id: "local", updatedAt: 100 }));

    await service.syncNow({ allowUpload: false });

    expect(client.puts).toEqual([]);
    expect(pendingRebind()).toBe("upload");
  });

  it("applies remote tombstones newer than the local session", async () => {
    const { client, repo, service } = await createHarness();
    repo.seed(
      makeSession({ id: "deleted", updatedAt: 5 }),
      makeSession({ id: "kept", updatedAt: 7 }),
    );
    client.deletions = [
      { id: "deleted", deletedAt: 6 },
      { id: "kept", deletedAt: 6 },
    ];

    const result = await service.syncNow();

    expect(result.deleted).toBe(1);
    expect(repo.sessions.has("deleted")).toBe(false);
    expect(repo.sessions.has("kept")).toBe(true);
    // The server's tombstone timestamp is preserved, not replaced with "now".
    expect(repo.tombstones.get("deleted")).toEqual({
      id: "deleted",
      deletedAt: 6,
    });
    // "kept" is missing remotely, so the newer local copy is uploaded.
    expect(result.uploaded).toBe(1);
    expect(client.puts.map((put) => put.id)).toEqual(["kept"]);
    // The server already stores this deletion, so it is not re-posted.
    expect(client.deletedIds).toEqual([]);
  });

  it("keeps a remote blob updated after the deletion timestamp", async () => {
    const { client, derived, repo, service } = await createHarness();
    repo.seed(makeSession({ id: "edited", updatedAt: NOW - 3_000 }));
    client.deletions = [{ id: "edited", deletedAt: NOW - 2_000 }];
    const remote = makeSession({
      id: "edited",
      updatedAt: NOW - 1_000,
      title: "remote edit",
    });
    client.summaries = [{ id: "edited", updatedAt: NOW - 1_000, size: 1 }];
    client.pages = [[await encryptedBlob(remote, derived)]];

    const result = await service.syncNow();

    // The stale local copy is removed, but the newer remote edit wins the
    // merge instead of being suppressed by a tombstone stamped "now".
    expect(repo.sessions.get("edited")).toMatchObject({
      updatedAt: NOW - 1_000,
      title: "remote edit",
    });
    expect(repo.tombstones.get("edited")).toEqual({
      id: "edited",
      deletedAt: NOW - 2_000,
    });
    expect(result.downloaded).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("merges remote pages and counts downloads and uploads", async () => {
    const { client, derived, repo, service } = await createHarness();
    repo.seed(
      makeSession({ id: "a", updatedAt: 10, title: "local A" }),
      makeSession({ id: "c", updatedAt: 30, title: "local C" }),
    );

    const remoteA = makeSession({ id: "a", updatedAt: 20, title: "remote A" });
    const remoteB = makeSession({ id: "b", updatedAt: 5, title: "remote B" });
    const remoteC = makeSession({ id: "c", updatedAt: 10, title: "remote C" });
    client.summaries = [
      { id: "a", updatedAt: 20, size: 1 },
      { id: "b", updatedAt: 5, size: 1 },
      { id: "c", updatedAt: 10, size: 1 },
    ];
    client.pages = [
      [await encryptedBlob(remoteA, derived)],
      [
        await encryptedBlob(remoteB, derived),
        await encryptedBlob(remoteC, derived),
      ],
    ];

    const result = await service.syncNow();

    expect(result).toMatchObject({
      uploaded: 1,
      downloaded: 2,
      deleted: 0,
      errors: [],
    });
    expect(client.blobPageRequests).toEqual([0, 1]);
    expect(repo.sessions.get("a")).toMatchObject({
      updatedAt: 20,
      title: "remote A",
    });
    expect(repo.sessions.get("b")).toMatchObject({
      updatedAt: 5,
      title: "remote B",
    });
    expect(repo.sessions.get("c")).toMatchObject({
      updatedAt: 30,
      title: "local C",
    });
    expect(client.puts.map((put) => put.id)).toEqual(["c"]);
  });

  it("retries pendingUpload sessions and clears the flag on success", async () => {
    const { client, repo, service } = await createHarness();
    repo.seed(
      makeSession({ id: "session-1", updatedAt: 100, pendingUpload: true }),
    );
    client.summaries = [{ id: "session-1", updatedAt: 100, size: 1 }];

    const result = await service.syncNow();

    expect(result.uploaded).toBe(1);
    expect(client.puts[0]).toMatchObject({
      id: "session-1",
      updatedAt: 100,
    });
    expect(repo.sessions.get("session-1")?.pendingUpload).toBe(false);
  });

  it("records per-item upload failures and marks the session pendingUpload", async () => {
    const { client, repo, service } = await createHarness();
    repo.seed(makeSession({ id: "session-1", updatedAt: 100 }));
    client.putError = new Error("offline");

    const result = await service.syncNow();

    expect(result.uploaded).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("session-1");
    expect(repo.sessions.get("session-1")?.pendingUpload).toBe(true);
  });

  it("skips oversized sessions during sync without dropping them", async () => {
    const { client, repo, service } = await createHarness();
    const oversized = makeSession({
      id: "oversized",
      tabs: [
        {
          url: "https://example.com/a",
          title: "x".repeat(LIMITS.maxSessionBytes + 1),
        },
      ],
    });
    repo.seed(oversized);

    const result = await service.syncNow();

    expect(result.uploaded).toBe(0);
    expect(result.errors.join(" ")).toMatch(/exceeds/);
    expect(client.puts).toEqual([]);
    expect(repo.sessions.get("oversized")).toEqual(oversized);
  });

  it("records decrypt failures and still merges the remaining blobs", async () => {
    const { client, derived, repo, service } = await createHarness();
    const good = makeSession({ id: "good", updatedAt: 50 });
    client.summaries = [{ id: "good", updatedAt: 50, size: 1 }];
    client.pages = [
      [
        { id: "bad", ciphertext: "AAAA", updatedAt: 1 },
        await encryptedBlob(good, derived),
      ],
    ];

    const result = await service.syncNow();

    expect(result.downloaded).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("bad");
    expect(repo.sessions.get("good")).toBeDefined();
  });

  it("force-uploads every eligible session after an upload rebind", async () => {
    const { client, repo, service } = await createHarness({ rebind: "upload" });
    repo.seed(
      makeSession({ id: "a", updatedAt: 100 }),
      makeSession({ id: "b", updatedAt: 200 }),
      makeSession({ id: "excluded", updatedAt: 300, syncExcluded: true }),
      makeSession({ id: "private", updatedAt: 400, incognito: true }),
    );
    client.summaries = [
      { id: "a", updatedAt: 100, size: 1 },
      { id: "b", updatedAt: 200, size: 1 },
    ];

    const result = await service.syncNow();

    expect(result.uploaded).toBe(2);
    expect(client.puts.map((put) => put.id).sort()).toEqual(["a", "b"]);
  });

  it("pushes only unexpired local tombstones and keeps them for later syncs", async () => {
    const { client, repo, service } = await createHarness();
    repo.tombstones.set("recent", { id: "recent", deletedAt: NOW - DAY_MS });
    repo.tombstones.set("expired", {
      id: "expired",
      deletedAt: NOW - 31 * DAY_MS,
    });

    await service.syncNow();

    expect(client.deletedIds).toEqual(["recent"]);
    expect(repo.tombstones.has("recent")).toBe(true);
  });

  it("does not re-post tombstones the server already has", async () => {
    const { client, repo, service } = await createHarness();
    repo.tombstones.set("equal", { id: "equal", deletedAt: NOW - DAY_MS });
    repo.tombstones.set("older-local", {
      id: "older-local",
      deletedAt: NOW - 2 * DAY_MS,
    });
    client.deletions = [
      { id: "equal", deletedAt: NOW - DAY_MS },
      { id: "older-local", deletedAt: NOW - DAY_MS },
    ];

    await service.syncNow();

    expect(client.deletedIds).toEqual([]);
    expect(repo.tombstones.has("equal")).toBe(true);
    expect(repo.tombstones.has("older-local")).toBe(true);
  });

  it("treats a DELETE 404 on a fresh key as a no-op", async () => {
    const { client, repo, service } = await createHarness();
    repo.tombstones.set("pending", { id: "pending", deletedAt: NOW - DAY_MS });
    client.deleteError = new SyncHttpError(
      404,
      "not_found",
      "Sync key not found.",
    );

    const result = await service.syncNow();

    expect(result.errors).toEqual([]);
    expect(client.deletedIds).toEqual([]);
  });

  it("marks existing sessions on a skip rebind and never uploads them", async () => {
    const { client, repo, service } = await createHarness({ rebind: "skip" });
    repo.seed(
      makeSession({ id: "local-1", updatedAt: 100 }),
      makeSession({ id: "private", updatedAt: 200, incognito: true }),
    );

    const result = await service.syncNow();

    expect(repo.sessions.get("local-1")).toMatchObject({
      syncExcluded: true,
      updatedAt: 100,
    });
    expect(repo.sessions.get("private")?.syncExcluded).toBeUndefined();
    expect(result.uploaded).toBe(0);
    expect(client.puts).toEqual([]);
  });

  it("still uploads sessions created after a skip rebind", async () => {
    const { client, repo, service } = await createHarness({ rebind: "skip" });
    repo.seed(makeSession({ id: "old", updatedAt: 100 }));
    await service.syncNow();
    expect(repo.sessions.get("old")?.syncExcluded).toBe(true);

    repo.seed(makeSession({ id: "new", updatedAt: 200 }));
    const result = await service.syncNow();

    expect(result.uploaded).toBe(1);
    expect(client.puts.map((put) => put.id)).toEqual(["new"]);
  });
});

describe("applySkipRebindIfPending", () => {
  it("marks current non-incognito sessions and consumes a skip marker", async () => {
    const { repo, service, consumePendingRebind, peekPendingRebind, pendingRebind } =
      await createHarness({ rebind: "skip" });
    repo.seed(
      makeSession({ id: "local-1", updatedAt: 100 }),
      makeSession({ id: "private", updatedAt: 200, incognito: true }),
      makeSession({ id: "already", updatedAt: 300, syncExcluded: true }),
    );

    await service.applySkipRebindIfPending();

    expect(repo.sessions.get("local-1")).toMatchObject({
      syncExcluded: true,
      updatedAt: 100,
    });
    expect(repo.sessions.get("private")?.syncExcluded).toBeUndefined();
    expect(repo.sessions.get("already")?.syncExcluded).toBe(true);
    expect(peekPendingRebind).toHaveBeenCalledTimes(1);
    expect(consumePendingRebind).toHaveBeenCalledTimes(1);
    expect(pendingRebind()).toBeUndefined();
  });

  it("leaves an upload marker untouched for the next full sync", async () => {
    const { repo, service, consumePendingRebind, pendingRebind } =
      await createHarness({ rebind: "upload" });
    repo.seed(makeSession({ id: "local-1" }));

    await service.applySkipRebindIfPending();

    expect(repo.patches).toEqual([]);
    expect(consumePendingRebind).not.toHaveBeenCalled();
    expect(pendingRebind()).toBe("upload");
  });

  it("does nothing when no marker is pending", async () => {
    const { repo, service, consumePendingRebind } = await createHarness();
    repo.seed(makeSession({ id: "local-1" }));

    await service.applySkipRebindIfPending();

    expect(repo.patches).toEqual([]);
    expect(consumePendingRebind).not.toHaveBeenCalled();
  });
});

describe("applyRemoteDeletions", () => {
  it("deletes only local sessions that are not newer than the tombstone", async () => {
    const { repo, service } = await createHarness();
    repo.seed(
      makeSession({ id: "old", updatedAt: 5 }),
      makeSession({ id: "new", updatedAt: 9 }),
    );

    const deleted = await service.applyRemoteDeletions([
      { id: "old", deletedAt: 6 },
      { id: "new", deletedAt: 6 },
      { id: "absent", deletedAt: 6 },
    ]);

    expect(deleted).toBe(1);
    expect(repo.sessions.has("old")).toBe(false);
    expect(repo.sessions.has("new")).toBe(true);
    // The server tombstone timestamp, not "now", is stored locally.
    expect(repo.tombstones.get("old")).toEqual({ id: "old", deletedAt: 6 });
  });
});
