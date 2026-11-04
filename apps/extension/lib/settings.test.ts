import { DEFAULT_SETTINGS } from "@savetabs/shared";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as settingsStore from "./settings";

type StorageSnapshot = Record<string, unknown>;

async function readStorage(): Promise<StorageSnapshot> {
  return (await fakeBrowser.storage.local.get(null)) as StorageSnapshot;
}

beforeEach(async () => {
  fakeBrowser.reset();
  // Clears any debounced write that survived the previous test.
  await settingsStore.resetSettings();
  fakeBrowser.reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  fakeBrowser.reset();
});

describe("loadSettings", () => {
  it("returns a fresh copy of the defaults when storage is empty", async () => {
    const settings = await settingsStore.loadSettings();

    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings).not.toBe(DEFAULT_SETTINGS);
    settings["tabs.excludedDomains"] = ["mutated.example"];
    expect(DEFAULT_SETTINGS["tabs.excludedDomains"]).toEqual([]);
  });

  it("merges stored values over the defaults", async () => {
    await fakeBrowser.storage.local.set({
      settings: {
        "tabs.closeAfterSave": false,
        "general.theme": "dark",
      },
    });

    const settings = await settingsStore.loadSettings();

    expect(settings["tabs.closeAfterSave"]).toBe(false);
    expect(settings["general.theme"]).toBe("dark");
    expect(settings["tabs.saveAllWindows"]).toBe(
      DEFAULT_SETTINGS["tabs.saveAllWindows"],
    );
    expect(Object.keys(settings)).toHaveLength(
      Object.keys(DEFAULT_SETTINGS).length,
    );
  });

  it("drops invalid and unknown stored values instead of failing", async () => {
    await fakeBrowser.storage.local.set({
      settings: {
        "general.confirmThreshold": 9999,
        "memory.timeoutMinutes": 45,
        "tabs.excludedDomains": "not-an-array",
        "general.theme": "dark",
        "not.a.setting": true,
      },
    });

    const settings = await settingsStore.loadSettings();

    expect(settings["general.confirmThreshold"]).toBe(
      DEFAULT_SETTINGS["general.confirmThreshold"],
    );
    expect(settings["memory.timeoutMinutes"]).toBe(
      DEFAULT_SETTINGS["memory.timeoutMinutes"],
    );
    expect(settings["tabs.excludedDomains"]).toEqual([]);
    expect(settings["general.theme"]).toBe("dark");
    expect(settings).not.toHaveProperty("not.a.setting");
  });

  it("falls back to defaults when stored settings are not an object", async () => {
    await fakeBrowser.storage.local.set({ settings: "not-json-object" });

    await expect(settingsStore.loadSettings()).resolves.toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it("falls back to defaults when the storage read rejects", async () => {
    vi.spyOn(fakeBrowser.storage.local, "get").mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    await expect(settingsStore.loadSettings()).resolves.toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it("returns pending saves before the debounced write flushes", async () => {
    await settingsStore.saveSetting("general.theme", "dark");

    await expect(settingsStore.loadSettings()).resolves.toMatchObject({
      "general.theme": "dark",
    });
  });
});

describe("saveSetting", () => {
  it("persists the full settings object and version after the debounce", async () => {
    await fakeBrowser.storage.local.set({ settings: { "tabs.closeAfterSave": false } });

    await settingsStore.saveSetting("general.theme", "dark");

    expect((await readStorage()).settings).toEqual({
      "tabs.closeAfterSave": false,
    });
    await vi.advanceTimersByTimeAsync(199);
    expect((await readStorage()).settings).toEqual({
      "tabs.closeAfterSave": false,
    });

    await vi.advanceTimersByTimeAsync(1);

    const stored = await readStorage();
    expect(stored.settingsVersion).toBe(1);
    const persisted = stored.settings as Record<string, unknown>;
    expect(persisted["general.theme"]).toBe("dark");
    expect(persisted["tabs.closeAfterSave"]).toBe(false);
    expect(Object.keys(persisted)).toHaveLength(
      Object.keys(DEFAULT_SETTINGS).length,
    );
  });

  it("coalesces rapid saves into a single debounced write", async () => {
    const setSpy = vi.spyOn(fakeBrowser.storage.local, "set");

    await settingsStore.saveSetting("general.theme", "dark");
    await vi.advanceTimersByTimeAsync(150);
    await settingsStore.saveSetting("general.showBadgeCount", false);
    await vi.advanceTimersByTimeAsync(199);

    expect(setSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        "general.theme": "dark",
        "general.showBadgeCount": false,
      }),
      settingsVersion: 1,
    });
  });

  it("serializes concurrent saves so no change is lost", async () => {
    await Promise.all([
      settingsStore.saveSetting("general.theme", "dark"),
      settingsStore.saveSetting("general.showBadgeCount", false),
    ]);

    await vi.advanceTimersByTimeAsync(200);

    const persisted = (await readStorage()).settings as Record<string, unknown>;
    expect(persisted["general.theme"]).toBe("dark");
    expect(persisted["general.showBadgeCount"]).toBe(false);
  });

  it("rejects unknown keys with a typed error and persists nothing", async () => {
    await expect(
      settingsStore.saveSetting("not.a.setting", true),
    ).rejects.toMatchObject({
      name: "InvalidSettingError",
      key: "not.a.setting",
    });

    await vi.advanceTimersByTimeAsync(200);
    expect((await readStorage()).settings).toBeUndefined();
  });

  it("rejects values that fail schema validation", async () => {
    await expect(
      settingsStore.saveSetting("general.confirmThreshold", 9999),
    ).rejects.toBeInstanceOf(settingsStore.InvalidSettingError);
    await expect(
      settingsStore.saveSetting("memory.timeoutMinutes", 45),
    ).rejects.toBeInstanceOf(settingsStore.InvalidSettingError);
    await expect(
      settingsStore.saveSetting("general.theme", "neon"),
    ).rejects.toBeInstanceOf(settingsStore.InvalidSettingError);

    await vi.advanceTimersByTimeAsync(200);
    expect((await readStorage()).settings).toBeUndefined();
  });
});

describe("resetSettings", () => {
  it("restores defaults immediately, cancels pending writes and keeps sessions", async () => {
    await fakeBrowser.storage.local.set({ sessions: [{ id: "keep-me" }] });
    await settingsStore.saveSetting("general.theme", "dark");

    await settingsStore.resetSettings();

    const stored = await readStorage();
    expect(stored.sessions).toEqual([{ id: "keep-me" }]);
    expect(stored.settingsVersion).toBe(1);
    expect(stored.settings).toEqual(DEFAULT_SETTINGS);
    await expect(settingsStore.loadSettings()).resolves.toEqual(
      DEFAULT_SETTINGS,
    );

    // The pending "dark" write was cancelled, so the defaults stay.
    await vi.advanceTimersByTimeAsync(500);
    expect((await readStorage()).settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe("onSettingsChanged", () => {
  it("delivers validated settings, ignores unrelated keys and unsubscribes", async () => {
    const received: Array<Record<string, unknown>> = [];
    const unsubscribe = settingsStore.onSettingsChanged((next) =>
      received.push(next),
    );

    await fakeBrowser.storage.local.set({ unrelated: true });
    expect(received).toHaveLength(0);

    await fakeBrowser.storage.local.set({
      settings: { "general.theme": "dark", "general.confirmThreshold": -1 },
    });

    expect(received).toHaveLength(1);
    expect(received[0]["general.theme"]).toBe("dark");
    expect(received[0]["general.confirmThreshold"]).toBe(
      DEFAULT_SETTINGS["general.confirmThreshold"],
    );
    expect(received[0]["tabs.closeAfterSave"]).toBe(
      DEFAULT_SETTINGS["tabs.closeAfterSave"],
    );

    unsubscribe();
    await fakeBrowser.storage.local.set({ settings: { "general.theme": "light" } });
    expect(received).toHaveLength(1);
  });
});
