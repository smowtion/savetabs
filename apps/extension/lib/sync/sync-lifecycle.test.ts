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
import { SYNC_KEY_STORAGE_KEY } from "./key-store";
import {
  SYNC_LAST_AT_STORAGE_KEY,
  SYNC_RETRY_ALARM_NAME,
  SYNC_RETRY_PERIOD_MINUTES,
  applySyncAlarm,
  deleteAllCloudData,
  readLastSyncAt,
  retryPendingSync,
  syncOnStartup,
  syncSavedSession,
} from "./sync-lifecycle";
import { enqueueUpload, syncNow } from "./sync-service";

vi.mock("./sync-service", () => ({
  enqueueUpload: vi.fn(),
  syncNow: vi.fn(),
}));

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

beforeEach(async () => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  syncNowMock.mockResolvedValue({
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    errors: [],
  });
  enqueueUploadMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

    expect(syncNowMock).toHaveBeenCalledTimes(1);
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

  it("contains sync failures instead of breaking the worker", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoDownload": true });
    syncNowMock.mockRejectedValue(new Error("network down"));

    await expect(syncOnStartup()).resolves.toBeUndefined();
    await expect(readLastSyncAt()).resolves.toBeUndefined();
  });
});

describe("retryPendingSync", () => {
  it("runs a sync while sync is enabled", async () => {
    await seedSettings({ "sync.enabled": true });

    await retryPendingSync();

    expect(syncNowMock).toHaveBeenCalledTimes(1);
    await expect(readLastSyncAt()).resolves.toEqual(expect.any(Number));
  });

  it("does nothing after sync is disabled", async () => {
    await seedSettings({ "sync.enabled": false });

    await retryPendingSync();

    expect(syncNowMock).not.toHaveBeenCalled();
  });

  it("contains failures", async () => {
    await seedSettings({ "sync.enabled": true });
    syncNowMock.mockRejectedValue(new Error("boom"));

    await expect(retryPendingSync()).resolves.toBeUndefined();
  });
});

describe("syncSavedSession", () => {
  it("uploads the freshly saved session when auto-upload is on", async () => {
    await seedSettings({ "sync.enabled": true, "sync.autoUpload": true });
    const session = makeSession("new-session");

    await syncSavedSession(session);

    expect(enqueueUploadMock).toHaveBeenCalledTimes(1);
    expect(enqueueUploadMock).toHaveBeenCalledWith(session);
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
  it("deletes every cloud session for the derived key", async () => {
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
  });

  it("treats a 404 as success because a fresh key has no cloud data", async () => {
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
  });

  it("rejects with an auth error when the server rejects the key", async () => {
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
  });

  it("rejects without contacting the server when no key exists", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteAllCloudData()).rejects.toBeInstanceOf(SyncAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
