import {
  DEFAULT_SETTINGS,
  SyncAuthError,
  deriveKeys,
  generateKey,
  parseKey,
  type Session,
  type Settings,
} from "@savetabs/shared";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE } from "../config";
import { SESSIONS_DB_NAME, closeSessionsDb } from "../sessions-db";
import { addSession, listSessions } from "../sessions-repo";
import {
  SETTINGS_STORAGE_KEY,
  loadSettings,
  resetSettings,
} from "../settings";
import { SYNC_KEY_REBIND_STORAGE_KEY, SYNC_KEY_STORAGE_KEY } from "./key-store";
import {
  SYNC_LAST_AT_STORAGE_KEY,
  SYNC_RETRY_ALARM_NAME,
  SYNC_RETRY_PERIOD_MINUTES,
  SYNC_STARTUP_INTERVAL_MS,
  applySyncAlarm,
  deleteAllCloudData,
  readLastSyncAt,
  retryPendingUploads,
  rotateSyncKey,
  syncOnStartup,
  syncSavedSession,
} from "./sync-lifecycle";
import { enqueueUpload, syncNow } from "./sync-service";

vi.mock("./sync-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sync-service")>();
  return {
    ...actual,
    enqueueUpload: vi.fn(),
    syncNow: vi.fn(),
  };
});

const syncNowMock = vi.mocked(syncNow);
const enqueueUploadMock = vi.mocked(enqueueUpload);

function settingsWith(overrides: Settings = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

async function seedSettings(overrides: Settings = {}): Promise<void> {
  await fakeBrowser.storage.local.set({ settings: settingsWith(overrides) });
}

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    createdAt: 1,
    updatedAt: 1,
    source: "window",
    tabs: [],
    ...overrides,
  };
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

beforeEach(async () => {
  fakeBrowser.reset();
  await resetSettings();
  await closeSessionsDb();
  await deleteDatabase();
  vi.clearAllMocks();
  syncNowMock.mockResolvedValue({
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    errors: [],
  });
  enqueueUploadMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await closeSessionsDb();
  // Cancels any debounced settings write left by `deleteAllCloudData` before
  // the next test resets the fake browser storage.
  await resetSettings();
});

describe("applySyncAlarm", () => {
  it("creates a five-minute retry alarm when sync is enabled", async () => {
    await applySyncAlarm(settingsWith({ "sync.enabled": true }));

    const alarm = await fakeBrowser.alarms.get(SYNC_RETRY_ALARM_NAME);
    expect(alarm?.periodInMinutes).toBe(SYNC_RETRY_PERIOD_MINUTES);
  });

  it("does not postpone an existing retry alarm", async () => {
    await fakeBrowser.alarms.create(SYNC_RETRY_ALARM_NAME, {
      periodInMinutes: SYNC_RETRY_PERIOD_MINUTES,
    });
    const createSpy = vi.spyOn(fakeBrowser.alarms, "create");

    await applySyncAlarm(settingsWith({ "sync.enabled": true }));

    expect(createSpy).not.toHaveBeenCalled();
  });

  it("clears the retry alarm when sync is disabled", async () => {
    await fakeBrowser.alarms.create(SYNC_RETRY_ALARM_NAME, {
      periodInMinutes: SYNC_RETRY_PERIOD_MINUTES,
    });

    await applySyncAlarm(settingsWith({ "sync.enabled": false }));

    await expect(
      fakeBrowser.alarms.get(SYNC_RETRY_ALARM_NAME),
    ).resolves.toBeUndefined();
  });
});

describe("syncOnStartup", () => {
  it("syncs at startup when sync and auto-download are enabled", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoDownload": true });

    await syncOnStartup();

    expect(syncNowMock).toHaveBeenCalledWith({ allowUpload: true });
    await expect(readLastSyncAt()).resolves.toEqual(expect.any(Number));
  });

  it("honors sync.autoUpload=false during the startup merge", async () => {
    await seedSettings({
      "sync.enabled": true,
      "sync.autoDownload": true,
      "sync.autoUpload": false,
    });

    await syncOnStartup();

    expect(syncNowMock).toHaveBeenCalledWith({ allowUpload: false });
    await expect(readLastSyncAt()).resolves.toEqual(expect.any(Number));
  });

  it("does nothing when auto-download is off", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoDownload": false });

    await syncOnStartup();

    expect(syncNowMock).not.toHaveBeenCalled();
  });

  it("does nothing when sync is disabled", async () => {
    await seedSettings({ "sync.enabled": false, "sync.autoDownload": true });

    await syncOnStartup();

    expect(syncNowMock).not.toHaveBeenCalled();
  });

  it("skips a startup merge when a recent full sync completed", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoDownload": true });
    await fakeBrowser.storage.local.set({
      [SYNC_LAST_AT_STORAGE_KEY]: Date.now() - 60_000,
    });

    await syncOnStartup();

    expect(syncNowMock).not.toHaveBeenCalled();
  });

  it("syncs again once the startup interval has passed", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoDownload": true });
    await fakeBrowser.storage.local.set({
      [SYNC_LAST_AT_STORAGE_KEY]: Date.now() - SYNC_STARTUP_INTERVAL_MS - 1,
    });

    await syncOnStartup();

    expect(syncNowMock).toHaveBeenCalledTimes(1);
  });

  it("contains sync failures instead of breaking the worker", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoDownload": true });
    syncNowMock.mockRejectedValue(new Error("network down"));

    await expect(syncOnStartup()).resolves.toBeUndefined();
    await expect(readLastSyncAt()).resolves.toBeUndefined();
  });
});

describe("retryPendingUploads", () => {
  it("uploads only pending sessions and never runs a full sync", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoUpload": true });
    await addSession(makeSession("pending", { pendingUpload: true }));
    await addSession(makeSession("clean"));
    await addSession(
      makeSession("private", { pendingUpload: true, incognito: true }),
    );
    await addSession(
      makeSession("excluded", { pendingUpload: true, syncExcluded: true }),
    );

    await retryPendingUploads();

    // No remote list, download or merge: the retry path is upload-only.
    expect(syncNowMock).not.toHaveBeenCalled();
    expect(enqueueUploadMock).toHaveBeenCalledTimes(1);
    expect(enqueueUploadMock.mock.calls[0]?.[0]).toMatchObject({
      id: "pending",
      pendingUpload: true,
    });

    // Other local sessions are not modified by the retry pass.
    const stored = await listSessions();
    expect(stored.find((session) => session.id === "clean")).toMatchObject({
      id: "clean",
    });
    expect(
      stored.find((session) => session.id === "clean")?.pendingUpload,
    ).toBeUndefined();
    expect(
      stored.find((session) => session.id === "excluded")?.syncExcluded,
    ).toBe(true);
  });

  it("applies a staged skip rebind before uploading pending sessions", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoUpload": true });
    await fakeBrowser.storage.local.set({
      [SYNC_KEY_REBIND_STORAGE_KEY]: "skip",
    });
    await addSession(makeSession("pending", { pendingUpload: true }));

    await retryPendingUploads();

    // The import promise ("local sessions will not be uploaded") wins even
    // though no full sync has consumed the marker yet.
    expect(enqueueUploadMock).not.toHaveBeenCalled();
    const stored = await listSessions();
    expect(
      stored.find((session) => session.id === "pending")?.syncExcluded,
    ).toBe(true);
    const raw = await fakeBrowser.storage.local.get(
      SYNC_KEY_REBIND_STORAGE_KEY,
    );
    expect(raw[SYNC_KEY_REBIND_STORAGE_KEY]).toBeUndefined();
  });

  it("leaves a staged upload rebind for the next full sync", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoUpload": true });
    await fakeBrowser.storage.local.set({
      [SYNC_KEY_REBIND_STORAGE_KEY]: "upload",
    });
    await addSession(makeSession("pending", { pendingUpload: true }));

    await retryPendingUploads();

    expect(enqueueUploadMock).toHaveBeenCalledTimes(1);
    const raw = await fakeBrowser.storage.local.get(
      SYNC_KEY_REBIND_STORAGE_KEY,
    );
    expect(raw[SYNC_KEY_REBIND_STORAGE_KEY]).toBe("upload");
  });

  it("does nothing when auto-upload is off", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoUpload": false });
    await addSession(makeSession("pending", { pendingUpload: true }));

    await retryPendingUploads();

    expect(syncNowMock).not.toHaveBeenCalled();
    expect(enqueueUploadMock).not.toHaveBeenCalled();
  });

  it("does nothing after sync is disabled", async () => {
    await seedSettings({ "sync.enabled": false, "sync.autoUpload": true });
    await addSession(makeSession("pending", { pendingUpload: true }));

    await retryPendingUploads();

    expect(syncNowMock).not.toHaveBeenCalled();
    expect(enqueueUploadMock).not.toHaveBeenCalled();
  });

  it("contains per-session failures and still tries the rest", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoUpload": true });
    await addSession(makeSession("first", { pendingUpload: true }));
    await addSession(makeSession("second", { pendingUpload: true }));
    enqueueUploadMock.mockRejectedValueOnce(new Error("network down"));

    await expect(retryPendingUploads()).resolves.toBeUndefined();

    expect(enqueueUploadMock).toHaveBeenCalledTimes(2);
  });
});

describe("syncSavedSession", () => {
  it("uploads the freshly saved session when auto-upload is on", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoUpload": true });
    const session = makeSession("new-session");

    await syncSavedSession(session);

    expect(enqueueUploadMock).toHaveBeenCalledTimes(1);
    // The flag is carried into the upload so success clears it afterwards.
    expect(enqueueUploadMock).toHaveBeenCalledWith({
      ...session,
      pendingUpload: true,
    });
  });

  it("marks the session for retry before attempting the upload", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoUpload": true });
    const session = makeSession("new-session");
    await addSession(session);

    await syncSavedSession(session);

    const stored = (await listSessions()).find(
      (candidate) => candidate.id === "new-session",
    );
    expect(stored?.pendingUpload).toBe(true);
  });

  it("skips when auto-upload is off", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoUpload": false });

    await syncSavedSession(makeSession("new-session"));

    expect(enqueueUploadMock).not.toHaveBeenCalled();
  });

  it("skips when sync is disabled", async () => {
    await seedSettings({ "sync.enabled": false, "sync.autoUpload": true });

    await syncSavedSession(makeSession("new-session"));

    expect(enqueueUploadMock).not.toHaveBeenCalled();
  });

  it("never uploads a session excluded by a key import", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoUpload": true });

    await syncSavedSession(
      makeSession("excluded-session", { syncExcluded: true }),
    );

    expect(enqueueUploadMock).not.toHaveBeenCalled();
  });

  it("never uploads an incognito session", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoUpload": true });

    await syncSavedSession(makeSession("private-session", { incognito: true }));

    expect(enqueueUploadMock).not.toHaveBeenCalled();
  });

  it("contains upload failures so saving still succeeds", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoUpload": true });
    enqueueUploadMock.mockRejectedValue(new Error("network down"));

    await expect(
      syncSavedSession(makeSession("new-session")),
    ).resolves.toBeUndefined();
  });
});

describe("readLastSyncAt", () => {
  it("ignores malformed stored values", async () => {
    await fakeBrowser.storage.local.set({ [SYNC_LAST_AT_STORAGE_KEY]: "soon" });

    await expect(readLastSyncAt()).resolves.toBeUndefined();
  });
});

describe("deleteAllCloudData", () => {
  it("deletes cloud data, turns sync off and keeps local sessions", async () => {
    await seedSettings({ "sync.enabled": true });
    await fakeBrowser.alarms.create(SYNC_RETRY_ALARM_NAME, {
      periodInMinutes: SYNC_RETRY_PERIOD_MINUTES,
    });
    await addSession(makeSession("local"));
    await addSession(makeSession("excluded", { syncExcluded: true }));
    const key = generateKey();
    await fakeBrowser.storage.local.set({ [SYNC_KEY_STORAGE_KEY]: key });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteAllCloudData();

    const derived = await deriveKeys(parseKey(key));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${API_BASE}/v1/keys/${derived.authId}`,
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("DELETE");

    // Sync is turned off so the kept local sessions are not re-uploaded.
    await expect(loadSettings()).resolves.toMatchObject({
      "sync.enabled": false,
    });
    // The write is flushed, not merely staged: a crash right after the success
    // response must not leave sync enabled on disk.
    const raw = await fakeBrowser.storage.local.get(SETTINGS_STORAGE_KEY);
    expect((raw[SETTINGS_STORAGE_KEY] as Settings)["sync.enabled"]).toBe(false);

    const stored = await listSessions();
    expect(stored).toHaveLength(2);
    expect(stored.find((session) => session.id === "local")).toBeDefined();
    expect(
      stored.find((session) => session.id === "excluded")?.syncExcluded,
    ).toBe(true);

    // The retry alarm must not survive a "delete cloud data" success.
    await expect(
      fakeBrowser.alarms.get(SYNC_RETRY_ALARM_NAME),
    ).resolves.toBeUndefined();
  });

  it("treats a 404 as success and still turns sync off", async () => {
    await seedSettings({ "sync.enabled": true });
    await fakeBrowser.storage.local.set({
      [SYNC_KEY_STORAGE_KEY]: generateKey(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "not_found" } }), {
          status: 404,
        }),
      ),
    );

    await expect(deleteAllCloudData()).resolves.toBeUndefined();
    await expect(loadSettings()).resolves.toMatchObject({
      "sync.enabled": false,
    });
  });

  it("rejects with an auth error when the server rejects the key", async () => {
    await seedSettings({ "sync.enabled": true });
    await fakeBrowser.storage.local.set({
      [SYNC_KEY_STORAGE_KEY]: generateKey(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
          status: 401,
        }),
      ),
    );

    await expect(deleteAllCloudData()).rejects.toBeInstanceOf(SyncAuthError);
    await expect(loadSettings()).resolves.toMatchObject({
      "sync.enabled": true,
    });
  });

  it("rejects without contacting the server when no key exists", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteAllCloudData()).rejects.toBeInstanceOf(SyncAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("rotateSyncKey", () => {
  it("stores the new key and deletes the old key's cloud data", async () => {
    const oldKey = generateKey();
    await fakeBrowser.storage.local.set({ [SYNC_KEY_STORAGE_KEY]: oldKey });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await rotateSyncKey();

    const oldDerived = await deriveKeys(parseKey(oldKey));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${API_BASE}/v1/keys/${oldDerived.authId}`,
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("DELETE");
    expect(result.revocation).toBe("deleted");
    expect(result.key).not.toBe(oldKey);

    const stored = await fakeBrowser.storage.local.get([
      SYNC_KEY_STORAGE_KEY,
      SYNC_KEY_REBIND_STORAGE_KEY,
    ]);
    expect(stored[SYNC_KEY_STORAGE_KEY]).toBe(result.key);
    expect(stored[SYNC_KEY_REBIND_STORAGE_KEY]).toBe("upload");
  });

  it("treats a 404 for the old key as already deleted", async () => {
    await fakeBrowser.storage.local.set({
      [SYNC_KEY_STORAGE_KEY]: generateKey(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "not_found" } }), {
          status: 404,
        }),
      ),
    );

    const result = await rotateSyncKey();

    expect(result.revocation).toBe("deleted");
  });

  it("keeps the rotation when revoking the old data fails", async () => {
    const oldKey = generateKey();
    await fakeBrowser.storage.local.set({ [SYNC_KEY_STORAGE_KEY]: oldKey });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await rotateSyncKey();

    expect(result.revocation).toBe("failed");
    const stored = await fakeBrowser.storage.local.get([
      SYNC_KEY_STORAGE_KEY,
      SYNC_KEY_REBIND_STORAGE_KEY,
    ]);
    expect(stored[SYNC_KEY_STORAGE_KEY]).toBe(result.key);
    expect(stored[SYNC_KEY_REBIND_STORAGE_KEY]).toBe("upload");
    // The failure is logged without ever including the key itself.
    const logged = JSON.stringify(consoleSpy.mock.calls);
    expect(logged).not.toContain(oldKey);
    expect(logged).not.toContain(result.key);
  });

  it("does not contact the server when no key was stored", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const result = await rotateSyncKey();

    expect(result.revocation).toBe("none");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      fakeBrowser.storage.local.get(SYNC_KEY_STORAGE_KEY),
    ).resolves.toEqual({
      [SYNC_KEY_STORAGE_KEY]: result.key,
    });
  });
});
