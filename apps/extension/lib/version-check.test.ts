/**
 * Tests for the extension update check.
 *
 * The update endpoint publishes one version per browser; the check must read
 * the current browser's entry, compare numeric version segments (ignoring
 * prerelease suffixes), and never reject: a failed check returns `null` so the
 * background service worker keeps running.
 */

import type { VersionInfo } from "@savetabs/shared";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE, VERSION_MANIFEST_URL } from "./config";
import { STORE_LISTING_URLS } from "./store-urls";
import {
  LATEST_VERSION_STORAGE_KEY,
  UPDATE_AVAILABLE_STORAGE_KEY,
  VERSION_CHECK_ALARM_NAME,
  VERSION_CHECK_PERIOD_MINUTES,
  checkForUpdate,
  currentBrowser,
  ensureVersionCheckAlarm,
  readUpdateState,
  reconcileUpdateState,
  runVersionCheck,
  storeListingUrl,
} from "./version-check";

type Manifest = ReturnType<typeof fakeBrowser.runtime.getManifest>;

/** Pin the installed extension version reported by the manifest. */
function stubVersion(version: string): void {
  vi.spyOn(fakeBrowser.runtime, "getManifest").mockReturnValue({
    version,
  } as unknown as Manifest);
}

function versionInfo(
  chrome = "1.0.0",
  firefox = "1.0.0",
): VersionInfo {
  return {
    extension: { chrome, firefox },
    notesUrl: "https://savetabs.example/releases",
    updatedAt: 1_700_000_000_000,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkForUpdate", () => {
  it("reports no update when the published version matches", async () => {
    stubVersion("1.2.3");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(versionInfo("1.2.3", "1.2.3")));

    await expect(checkForUpdate(fetchMock)).resolves.toEqual({
      latest: "1.2.3",
      current: "1.2.3",
      updateAvailable: false,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(VERSION_MANIFEST_URL);
  });

  it("falls back to the Worker endpoint when the static manifest fails", async () => {
    stubVersion("1.2.3");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse(versionInfo("1.2.3", "1.2.3")));

    await expect(checkForUpdate(fetchMock)).resolves.toEqual({
      latest: "1.2.3",
      current: "1.2.3",
      updateAvailable: false,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(VERSION_MANIFEST_URL);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${API_BASE}/v1/version`);
  });

  it("reports an update when the published version is newer", async () => {
    stubVersion("1.2.3");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(versionInfo("1.2.4", "1.2.4")));

    await expect(checkForUpdate(fetchMock)).resolves.toEqual({
      latest: "1.2.4",
      current: "1.2.3",
      updateAvailable: true,
    });
  });

  it("reports no update when the installed version is newer", async () => {
    stubVersion("2.0.0");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(versionInfo("1.9.9", "1.9.9")));

    const result = await checkForUpdate(fetchMock);

    expect(result?.updateAvailable).toBe(false);
  });

  it("compares numeric segments instead of strings", async () => {
    stubVersion("1.2.9");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(versionInfo("1.2.10", "1.2.10")));

    const result = await checkForUpdate(fetchMock);

    expect(result?.latest).toBe("1.2.10");
    expect(result?.updateAvailable).toBe(true);
  });

  it("treats missing segments as zero", async () => {
    stubVersion("1.2");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(versionInfo("1.2.0", "1.2.0")));

    const result = await checkForUpdate(fetchMock);

    expect(result?.updateAvailable).toBe(false);
  });

  it("ignores prerelease suffixes when comparing", async () => {
    stubVersion("1.2.3-beta.1");
    const sameRelease = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(versionInfo("1.2.3", "1.2.3")));

    const equal = await checkForUpdate(sameRelease);
    expect(equal?.current).toBe("1.2.3-beta.1");
    expect(equal?.latest).toBe("1.2.3");
    expect(equal?.updateAvailable).toBe(false);

    stubVersion("1.2.3");
    const nextRelease = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(versionInfo("1.2.4-rc.2", "1.2.4-rc.2")));

    const newer = await checkForUpdate(nextRelease);
    expect(newer?.latest).toBe("1.2.4-rc.2");
    expect(newer?.updateAvailable).toBe(true);
  });

  it("compares against the current browser's published version", async () => {
    stubVersion("0.9.0");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(versionInfo("1.0.0", "9.0.0")));

    const result = await checkForUpdate(fetchMock);
    const expected = currentBrowser() === "firefox" ? "9.0.0" : "1.0.0";

    expect(result?.latest).toBe(expected);
    expect(result?.updateAvailable).toBe(true);
  });

  it("returns null when the request fails", async () => {
    stubVersion("1.0.0");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network down"));

    await expect(checkForUpdate(fetchMock)).resolves.toBeNull();
  });

  it("returns null for a non-2xx response", async () => {
    stubVersion("1.0.0");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "nope" }, 503));

    await expect(checkForUpdate(fetchMock)).resolves.toBeNull();
  });

  it("returns null when the body is not JSON", async () => {
    stubVersion("1.0.0");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));

    await expect(checkForUpdate(fetchMock)).resolves.toBeNull();
  });

  it("returns null when the response shape is invalid", async () => {
    stubVersion("1.0.0");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ extension: {} }));

    await expect(checkForUpdate(fetchMock)).resolves.toBeNull();
  });

  it("returns null without a request when the manifest version is invalid", async () => {
    stubVersion("development");
    const fetchMock = vi.fn<typeof fetch>();

    await expect(checkForUpdate(fetchMock)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("storeListingUrl", () => {
  it("returns the placeholder Chrome listing", () => {
    expect(storeListingUrl("chrome")).toBe(STORE_LISTING_URLS.chrome);
    expect(storeListingUrl("chrome")).toContain("chromewebstore.google.com");
  });

  it("returns the placeholder Firefox listing", () => {
    expect(storeListingUrl("firefox")).toBe(STORE_LISTING_URLS.firefox);
    expect(storeListingUrl("firefox")).toContain("addons.mozilla.org");
  });

  it("selects the store from the WXT build target", () => {
    // WxtVitest leaves `import.meta.env.BROWSER` undefined, so the default is
    // the Chrome build.
    expect(currentBrowser()).toBe("chrome");
  });
});

describe("readUpdateState", () => {
  it("defaults to no update when nothing is stored", async () => {
    await expect(readUpdateState()).resolves.toEqual({
      updateAvailable: false,
      latestVersion: null,
    });
  });

  it("reads a persisted update", async () => {
    await fakeBrowser.storage.local.set({
      [UPDATE_AVAILABLE_STORAGE_KEY]: true,
      [LATEST_VERSION_STORAGE_KEY]: "2.0.0",
    });

    await expect(readUpdateState()).resolves.toEqual({
      updateAvailable: true,
      latestVersion: "2.0.0",
    });
  });

  it("ignores malformed stored values", async () => {
    await fakeBrowser.storage.local.set({
      [UPDATE_AVAILABLE_STORAGE_KEY]: "yes",
      [LATEST_VERSION_STORAGE_KEY]: 42,
    });

    await expect(readUpdateState()).resolves.toEqual({
      updateAvailable: false,
      latestVersion: null,
    });
  });
});

describe("runVersionCheck", () => {
  it("persists the available update", async () => {
    stubVersion("1.0.0");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(versionInfo("2.0.0", "2.0.0")));

    await expect(runVersionCheck(fetchMock)).resolves.toMatchObject({
      latest: "2.0.0",
      updateAvailable: true,
    });
    await expect(readUpdateState()).resolves.toEqual({
      updateAvailable: true,
      latestVersion: "2.0.0",
    });
  });

  it("clears the update flag when the check finds no update", async () => {
    await fakeBrowser.storage.local.set({
      [UPDATE_AVAILABLE_STORAGE_KEY]: true,
      [LATEST_VERSION_STORAGE_KEY]: "9.9.9",
    });
    stubVersion("1.0.0");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(versionInfo("1.0.0", "1.0.0")));

    await runVersionCheck(fetchMock);

    await expect(readUpdateState()).resolves.toEqual({
      updateAvailable: false,
      latestVersion: "1.0.0",
    });
  });

  it("keeps the previous state and logs when the check fails", async () => {
    await fakeBrowser.storage.local.set({
      [UPDATE_AVAILABLE_STORAGE_KEY]: true,
      [LATEST_VERSION_STORAGE_KEY]: "9.9.9",
    });
    stubVersion("1.0.0");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runVersionCheck(fetchMock)).resolves.toBeNull();

    await expect(readUpdateState()).resolves.toEqual({
      updateAvailable: true,
      latestVersion: "9.9.9",
    });
    // The underlying cause is logged, not just a generic failure message.
    expect(String(consoleSpy.mock.calls[0]?.[1])).toContain("network down");
  });

  it("logs a storage failure without throwing", async () => {
    stubVersion("1.0.0");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(versionInfo("2.0.0", "2.0.0")));
    vi.spyOn(fakeBrowser.storage.local, "set").mockRejectedValue(
      new Error("quota exceeded"),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runVersionCheck(fetchMock)).resolves.toMatchObject({
      latest: "2.0.0",
      updateAvailable: true,
    });
    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe("reconcileUpdateState", () => {
  it("clears a flag the installed version already satisfies", async () => {
    stubVersion("2.0.0");
    await fakeBrowser.storage.local.set({
      [UPDATE_AVAILABLE_STORAGE_KEY]: true,
      [LATEST_VERSION_STORAGE_KEY]: "2.0.0",
    });

    await expect(reconcileUpdateState()).resolves.toBe(true);

    await expect(readUpdateState()).resolves.toEqual({
      updateAvailable: false,
      latestVersion: "2.0.0",
    });
  });

  it("keeps a flag for a genuinely newer published version", async () => {
    stubVersion("2.0.0");
    await fakeBrowser.storage.local.set({
      [UPDATE_AVAILABLE_STORAGE_KEY]: true,
      [LATEST_VERSION_STORAGE_KEY]: "2.1.0",
    });

    await expect(reconcileUpdateState()).resolves.toBe(false);

    await expect(readUpdateState()).resolves.toEqual({
      updateAvailable: true,
      latestVersion: "2.1.0",
    });
  });

  it("clears a flag that cannot be verified", async () => {
    stubVersion("not-a-version");
    await fakeBrowser.storage.local.set({
      [UPDATE_AVAILABLE_STORAGE_KEY]: true,
      [LATEST_VERSION_STORAGE_KEY]: "2.0.0",
    });

    await expect(reconcileUpdateState()).resolves.toBe(true);
    await expect(readUpdateState()).resolves.toMatchObject({
      updateAvailable: false,
    });
  });

  it("does nothing when no update is recorded", async () => {
    stubVersion("1.0.0");
    const setSpy = vi.spyOn(fakeBrowser.storage.local, "set");

    await expect(reconcileUpdateState()).resolves.toBe(false);

    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("ensureVersionCheckAlarm", () => {
  it("creates a 24-hour update alarm", async () => {
    await ensureVersionCheckAlarm();

    const alarm = await fakeBrowser.alarms.get(VERSION_CHECK_ALARM_NAME);
    expect(alarm?.periodInMinutes).toBe(VERSION_CHECK_PERIOD_MINUTES);
    expect(VERSION_CHECK_PERIOD_MINUTES).toBe(24 * 60);
  });

  it("does not reset an existing alarm", async () => {
    await fakeBrowser.alarms.create(VERSION_CHECK_ALARM_NAME, {
      periodInMinutes: VERSION_CHECK_PERIOD_MINUTES,
    });
    const createSpy = vi.spyOn(fakeBrowser.alarms, "create");

    await ensureVersionCheckAlarm();

    expect(createSpy).not.toHaveBeenCalled();
  });
});
