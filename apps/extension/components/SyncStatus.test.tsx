import { SyncAuthError, createTranslator, type Session } from "@savetabs/shared";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSIONS_DB_NAME, closeSessionsDb } from "../lib/sessions-db";
import { addSession, listSessions } from "../lib/sessions-repo";
import {
  deleteAllCloudData,
  readLastSyncAt,
  recordSyncCompleted,
} from "../lib/sync/sync-lifecycle";
import { syncNow, type SyncResult } from "../lib/sync/sync-service";
import { SyncStatus } from "./SyncStatus";

vi.mock("../lib/sync/sync-service", () => ({
  syncNow: vi.fn(),
}));

vi.mock("../lib/sync/sync-lifecycle", () => ({
  deleteAllCloudData: vi.fn(),
  readLastSyncAt: vi.fn(),
  recordSyncCompleted: vi.fn(),
}));

const t = createTranslator("en");
const syncNowMock = vi.mocked(syncNow);
const readLastSyncAtMock = vi.mocked(readLastSyncAt);
const recordSyncCompletedMock = vi.mocked(recordSyncCompleted);
const deleteAllCloudDataMock = vi.mocked(deleteAllCloudData);

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
  await closeSessionsDb();
  await deleteDatabase();
  vi.clearAllMocks();
  readLastSyncAtMock.mockResolvedValue(undefined);
  recordSyncCompletedMock.mockResolvedValue(undefined);
  deleteAllCloudDataMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await closeSessionsDb();
});

describe("SyncStatus", () => {
  it("shows the sync state, relative last sync and pending upload count", async () => {
    readLastSyncAtMock.mockResolvedValue(Date.now() - 5 * 60 * 1000);
    await addSession(makeSession("pending", { pendingUpload: true }));
    await addSession(makeSession("synced", { pendingUpload: false }));

    render(<SyncStatus t={t} enabled />);

    expect(await screen.findByTestId("sync-state")).toHaveTextContent(
      "Sync is on.",
    );
    expect(await screen.findByText("5 minutes ago")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("sync-pending-count")).toHaveTextContent("1"),
    );
  });

  it("reports never-synced and a disabled Sync now when sync is off", async () => {
    render(<SyncStatus t={t} enabled={false} />);

    expect(await screen.findByTestId("sync-state")).toHaveTextContent(
      "Sync is off.",
    );
    expect(await screen.findByText("Never")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
  });

  it("runs a sync, shows the counters and records the last sync", async () => {
    let resolveSync: (result: SyncResult) => void = () => undefined;
    syncNowMock.mockImplementation(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveSync = resolve;
        }),
    );

    render(<SyncStatus t={t} enabled />);

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));

    const running = await screen.findByRole("button", { name: "Syncing…" });
    expect(running).toBeDisabled();

    await act(async () => {
      resolveSync({ uploaded: 2, downloaded: 1, deleted: 3, errors: [] });
    });

    expect(
      await screen.findByText("Uploaded 2, downloaded 1, deleted 3."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
    expect(recordSyncCompletedMock).toHaveBeenCalledTimes(1);
  });

  it("shows an auth banner instead of a fake success when the key is rejected", async () => {
    syncNowMock.mockRejectedValue(new SyncAuthError("unauthorized"));

    render(<SyncStatus t={t} enabled />);

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The sync key was rejected or the cloud data cannot be decrypted.",
    );
    expect(screen.queryByText(/Uploaded \d/)).not.toBeInTheDocument();
    expect(recordSyncCompletedMock).not.toHaveBeenCalled();
  });

  it("lists per-item errors from a partial sync", async () => {
    syncNowMock.mockResolvedValue({
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      errors: ["upload session-1: network down"],
    });

    render(<SyncStatus t={t} enabled />);
    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));

    expect(
      await screen.findByText("Some items could not be synced:"),
    ).toBeInTheDocument();
    expect(screen.getByText("upload session-1: network down")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting cloud data and keeps local sessions", async () => {
    await addSession(makeSession("local-only"));

    render(<SyncStatus t={t} enabled />);
    await userEvent.click(screen.getByRole("button", { name: "Delete cloud data" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Delete cloud data?",
    });
    expect(
      within(dialog).getByText(/Local sessions stay on this device/),
    ).toBeInTheDocument();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete cloud data" }),
    );

    expect(
      await screen.findByText(
        "Cloud data deleted. Local sessions were kept.",
      ),
    ).toBeInTheDocument();
    expect(deleteAllCloudDataMock).toHaveBeenCalledTimes(1);
    await expect(listSessions()).resolves.toHaveLength(1);
  });

  it("does not delete cloud data when the confirmation is cancelled", async () => {
    render(<SyncStatus t={t} enabled />);
    await userEvent.click(screen.getByRole("button", { name: "Delete cloud data" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Delete cloud data?",
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteAllCloudDataMock).not.toHaveBeenCalled();
  });

  it("surfaces an auth problem when cloud deletion is rejected", async () => {
    deleteAllCloudDataMock.mockRejectedValue(new SyncAuthError("unauthorized"));

    render(<SyncStatus t={t} enabled />);
    await userEvent.click(screen.getByRole("button", { name: "Delete cloud data" }));
    await userEvent.click(
      within(
        await screen.findByRole("dialog", { name: "Delete cloud data?" }),
      ).getByRole("button", { name: "Delete cloud data" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The sync key was rejected or the cloud data cannot be decrypted.",
    );
  });
});
