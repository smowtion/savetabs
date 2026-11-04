import { DEFAULT_SETTINGS, type Settings } from "@savetabs/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import {
  SESSIONS_PAGE_PATH,
  getSessionsPageUrl,
  openOrReuseSessionsPage,
} from "./sessions-page";

function settingsWith(overrides: Settings = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getSessionsPageUrl", () => {
  it("resolves the sessions entrypoint URL", () => {
    expect(getSessionsPageUrl()).toBe(
      fakeBrowser.runtime.getURL(SESSIONS_PAGE_PATH),
    );
  });
});

describe("openOrReuseSessionsPage", () => {
  it("opens a new tab when reuse is disabled", async () => {
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    const tabId = await openOrReuseSessionsPage(
      settingsWith({ "open.reuseSessionsTab": false }),
    );

    expect(createSpy).toHaveBeenCalledWith({ url: getSessionsPageUrl() });
    expect(tabId).toBeTypeOf("number");
  });

  it("opens a new tab when reuse is enabled but no sessions tab is open", async () => {
    await fakeBrowser.tabs.create({ url: "https://example.com" });
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    await openOrReuseSessionsPage(
      settingsWith({ "open.reuseSessionsTab": true }),
    );

    expect(createSpy).toHaveBeenCalledWith({ url: getSessionsPageUrl() });
  });

  it("reuses, activates and focuses an existing sessions tab", async () => {
    const existing = await fakeBrowser.tabs.create({
      url: getSessionsPageUrl(),
    });
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");
    const updateSpy = vi.spyOn(fakeBrowser.tabs, "update");
    const focusSpy = vi.spyOn(fakeBrowser.windows, "update");

    const tabId = await openOrReuseSessionsPage(
      settingsWith({ "open.reuseSessionsTab": true }),
    );

    expect(tabId).toBe(existing.id);
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith(existing.id, { active: true });
    if (typeof existing.windowId === "number") {
      expect(focusSpy).toHaveBeenCalledWith(existing.windowId, {
        focused: true,
      });
    }
  });

  it("ignores other tabs that merely contain the sessions path", async () => {
    await fakeBrowser.tabs.create({ url: "https://example.com/sessions.html" });
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    await openOrReuseSessionsPage(
      settingsWith({ "open.reuseSessionsTab": true }),
    );

    expect(createSpy).toHaveBeenCalledWith({ url: getSessionsPageUrl() });
  });
});
