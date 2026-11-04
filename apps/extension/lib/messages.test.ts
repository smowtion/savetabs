import {
  DEFAULT_SETTINGS,
  type SavedTab,
  type Session,
  type Settings,
} from "@savetabs/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { handleUiMessage, type UiResponse } from "./messages";
import type { SaveTabsResult } from "./save-flow";
import { SESSIONS_DB_NAME, closeSessionsDb } from "./sessions-db";
import { addSession, getSession, listSessions } from "./sessions-repo";

function settingsWith(overrides: Settings = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function makeSession(id: string, tabs: readonly SavedTab[]): Session {
  return { id, createdAt: 1, updatedAt: 1, source: "window", tabs: [...tabs] };
}

async function seedSettings(overrides: Settings = {}): Promise<void> {
  await fakeBrowser.storage.local.set({
    settings: settingsWith(overrides),
  });
}

async function seedWindowWithTabs(urls: readonly string[]): Promise<number[]> {
  const window = await fakeBrowser.windows.create({
    type: "normal",
    focused: true,
  });
  if (window?.id === undefined) {
    throw new Error("fakeBrowser.windows.create returned no window id");
  }
  const ids: number[] = [];
  for (const url of urls) {
    const tab = await fakeBrowser.tabs.create({
      url,
      windowId: window.id,
      active: false,
    });
    if (tab?.id !== undefined) ids.push(tab.id);
  }
  return ids;
}

async function seedWindowWithTab(url: string): Promise<void> {
  await seedWindowWithTabs([url]);
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

function expectOk(response: UiResponse): unknown {
  expect(response.ok).toBe(true);
  if (!response.ok) {
    throw new Error(`expected an ok response, got error "${response.code}"`);
  }
  return response.data;
}

beforeEach(async () => {
  fakeBrowser.reset();
  await closeSessionsDb();
  await deleteDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeSessionsDb();
});

describe("handleUiMessage", () => {
  it("saves the window for SAVE_TABS", async () => {
    await seedSettings({
      "open.openSessionsAfterSave": false,
      "tabs.closeAfterSave": false,
    });
    await seedWindowWithTab("https://example.com/saved");

    const response = await handleUiMessage({
      type: "SAVE_TABS",
      source: "window",
    });

    const data = expectOk(response) as SaveTabsResult;
    expect(data.session?.source).toBe("window");
    expect(data.session?.tabs.map((tab) => tab.url)).toEqual([
      "https://example.com/saved",
    ]);
    await expect(listSessions()).resolves.toHaveLength(1);
  });

  it("rejects SAVE_TABS with an unknown source", async () => {
    const response = await handleUiMessage({
      type: "SAVE_TABS",
      source: "everywhere",
    });

    expect(response).toEqual({ ok: false, code: "invalid_message" });
  });

  it("rejects SAVE_TABS with a non-boolean confirmation flag", async () => {
    const response = await handleUiMessage({
      type: "SAVE_TABS",
      source: "window",
      confirmed: "yes",
    });

    expect(response).toEqual({ ok: false, code: "invalid_message" });
  });

  it("requires confirmation above the close threshold without saving or closing", async () => {
    await seedSettings({
      "general.confirmThreshold": 2,
      "open.openSessionsAfterSave": false,
    });
    const tabIds = await seedWindowWithTabs([
      "https://example.com/one",
      "https://example.com/two",
      "https://example.com/three",
    ]);
    const remove = vi.spyOn(fakeBrowser.tabs, "remove");

    const response = await handleUiMessage({
      type: "SAVE_TABS",
      source: "window",
    });

    expect(response).toEqual({
      ok: false,
      code: "confirmation_required",
      data: { count: 3 },
    });
    await expect(listSessions()).resolves.toEqual([]);
    expect(remove).not.toHaveBeenCalled();
    const openTabs = await fakeBrowser.tabs.query({});
    expect(openTabs.map((tab) => tab.id)).toEqual(
      expect.arrayContaining(tabIds),
    );
  });

  it("saves and closes when the save is confirmed", async () => {
    await seedSettings({
      "general.confirmThreshold": 2,
      "open.openSessionsAfterSave": false,
    });
    const tabIds = await seedWindowWithTabs([
      "https://example.com/one",
      "https://example.com/two",
      "https://example.com/three",
    ]);
    const remove = vi
      .spyOn(fakeBrowser.tabs, "remove")
      .mockResolvedValue(undefined as never);

    const response = await handleUiMessage({
      type: "SAVE_TABS",
      source: "window",
      confirmed: true,
    });

    const data = expectOk(response) as SaveTabsResult;
    expect(data.session?.tabs).toHaveLength(3);
    expect(data.closed).toBe(3);
    await expect(listSessions()).resolves.toHaveLength(1);
    expect(remove).toHaveBeenCalledTimes(1);
    const removed = remove.mock.calls[0]?.[0] as number[];
    expect([...removed].sort()).toEqual([...tabIds].sort());
  });

  it("restores a stored session for RESTORE_SESSION", async () => {
    await addSession(
      makeSession("restore-me", [
        { url: "https://example.com/restore", title: "Restore" },
      ]),
    );
    const createSpy = vi.spyOn(fakeBrowser.tabs, "create");

    const response = await handleUiMessage({
      type: "RESTORE_SESSION",
      sessionId: "restore-me",
    });

    expect(expectOk(response)).toEqual({ opened: 1 });
    expect(createSpy).toHaveBeenCalledWith({
      url: "https://example.com/restore",
      active: false,
    });
  });

  it("reports a missing session for RESTORE_SESSION", async () => {
    const response = await handleUiMessage({
      type: "RESTORE_SESSION",
      sessionId: "missing",
    });

    expect(response).toEqual({ ok: false, code: "not_found" });
  });

  it("rejects RESTORE_SESSION without a session id", async () => {
    const response = await handleUiMessage({ type: "RESTORE_SESSION" });

    expect(response).toEqual({ ok: false, code: "invalid_message" });
  });

  it("deletes a stored session for DELETE_SESSION", async () => {
    await addSession(
      makeSession("delete-me", [
        { url: "https://example.com/delete", title: "Delete" },
      ]),
    );

    const response = await handleUiMessage({
      type: "DELETE_SESSION",
      sessionId: "delete-me",
    });

    expect(expectOk(response)).toEqual({ deleted: "delete-me" });
    await expect(getSession("delete-me")).resolves.toBeUndefined();
    await expect(listSessions()).resolves.toEqual([]);
  });

  it("deletes idempotently when the session is already gone", async () => {
    const response = await handleUiMessage({
      type: "DELETE_SESSION",
      sessionId: "already-gone",
    });

    expect(expectOk(response)).toEqual({ deleted: "already-gone" });
  });

  it("runs the discard sweep for DISCARD_NOW", async () => {
    const response = await handleUiMessage({ type: "DISCARD_NOW" });

    expect(expectOk(response)).toEqual({ discarded: 0 });
  });

  it("reports SYNC_NOW as not implemented", async () => {
    const response = await handleUiMessage({ type: "SYNC_NOW" });

    expect(response).toEqual({ ok: false, code: "not_implemented" });
  });

  it("reports unknown message types as not implemented", async () => {
    const response = await handleUiMessage({ type: "NOT_A_REAL_MESSAGE" });

    expect(response).toEqual({ ok: false, code: "not_implemented" });
  });

  it.each([null, "nope", 42, {}, { type: 42 }])(
    "rejects malformed messages: %j",
    async (message) => {
      const response = await handleUiMessage(message);

      expect(response).toEqual({ ok: false, code: "invalid_message" });
    },
  );
});
