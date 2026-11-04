import {
  DEFAULT_SETTINGS,
  LIMITS,
  createTranslator,
  type Session,
  type Settings,
} from "@savetabs/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetSettings } from "../lib/settings";
import { exportSettingsFile } from "../lib/settings-export";
import { exportSessionsFile } from "../lib/sessions-export";
import {
  SESSIONS_DB_NAME,
  SESSIONS_STORE_NAME,
  closeSessionsDb,
  openSessionsDb,
} from "../lib/sessions-db";
import {
  getSession,
  getTombstones,
  listSessions,
} from "../lib/sessions-repo";
import { AdvancedActions } from "./AdvancedActions";

const t = createTranslator("en");

let sessionCounter = 0;

function makeSession(overrides: Partial<Session> = {}): Session {
  sessionCounter += 1;
  return {
    id: `session-${sessionCounter}`,
    createdAt: sessionCounter,
    updatedAt: sessionCounter,
    source: "window",
    tabs: [{ url: `https://example.com/${sessionCounter}`, title: `Tab ${sessionCounter}` }],
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

/** Seeds sessions directly through the database layer, bypassing repo caps. */
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

function importFile(testId: string, file: File): void {
  fireEvent.change(screen.getByTestId(testId), {
    target: { files: [file] },
  });
}

function settingsFile(settings: Settings): File {
  return new File([exportSettingsFile(settings)], "savetabs-settings.json", {
    type: "application/json",
  });
}

function sessionsFile(sessions: readonly Session[]): File {
  return new File([exportSessionsFile(sessions)], "savetabs-sessions.json", {
    type: "application/json",
  });
}

/** Replaces the browser download primitives and captures what was written. */
function stubDownload(): {
  blobs: Blob[];
  revoke: ReturnType<typeof vi.fn>;
  clicked: HTMLAnchorElement[];
} {
  const blobs: Blob[] = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return "blob:mock";
  });
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    value: createObjectURL,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: revoke,
    configurable: true,
    writable: true,
  });
  const clicked: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      clicked.push(this);
    },
  );
  return { blobs, revoke, clicked };
}

const nativeCreateObjectURL = URL.createObjectURL;
const nativeRevokeObjectURL = URL.revokeObjectURL;

beforeEach(async () => {
  fakeBrowser.reset();
  await resetSettings();
  fakeBrowser.reset();
  await closeSessionsDb();
  await deleteDatabase();
  sessionCounter = 0;
});

afterEach(async () => {
  cleanup();
  await resetSettings();
  fakeBrowser.reset();
  await closeSessionsDb();
  vi.restoreAllMocks();
  Object.defineProperty(URL, "createObjectURL", {
    value: nativeCreateObjectURL,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: nativeRevokeObjectURL,
    configurable: true,
    writable: true,
  });
});

describe("AdvancedActions", () => {
  it("renders every action and the current storage usage", async () => {
    await seedSessions([makeSession(), makeSession()]);

    render(<AdvancedActions settings={DEFAULT_SETTINGS} t={t} />);

    expect(
      screen.getByRole("button", { name: "Export settings" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Import settings" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Export sessions" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Import sessions" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Reset to defaults" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Clear local sessions" }),
    ).toBeEnabled();
    expect(
      screen.getByText(
        "Session exports contain plaintext titles and URLs. Store the file somewhere private.",
      ),
    ).toBeInTheDocument();

    expect(
      await screen.findByText("Storage used: 2 sessions, 2 tabs"),
    ).toBeInTheDocument();
  });

  it("warns when local storage is near its limit", async () => {
    await seedSessions(
      Array.from({ length: Math.ceil(LIMITS.maxLocalSessions * 0.9) }, (_, index) =>
        makeSession({ id: `near-${index}`, tabs: [] }),
      ),
    );

    render(<AdvancedActions settings={DEFAULT_SETTINGS} t={t} />);

    expect(
      await screen.findByText(
        "Local storage is almost full. Export or delete sessions to free space.",
      ),
    ).toBeInTheDocument();
  });

  it("exports settings as a JSON download and revokes the object URL", async () => {
    const { blobs, revoke, clicked } = stubDownload();

    render(
      <AdvancedActions
        settings={{ ...DEFAULT_SETTINGS, "general.theme": "dark" }}
        t={t}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Export settings" }),
    );

    const blob = blobs[0];
    expect(blob).toBeDefined();
    const parsed = JSON.parse(await blob!.text()) as {
      app: string;
      kind: string;
      settings: Settings;
    };
    expect(parsed.app).toBe("savetabs");
    expect(parsed.kind).toBe("settings");
    expect(parsed.settings["general.theme"]).toBe("dark");
    expect(clicked[0]?.download).toBe("savetabs-settings.json");
    expect(revoke).toHaveBeenCalledWith("blob:mock");
    expect(
      screen.getByText("Exported savetabs-settings.json."),
    ).toBeInTheDocument();
  });

  it("exports sessions as a plaintext JSON download", async () => {
    const session = makeSession();
    await seedSessions([session]);
    const { blobs, revoke, clicked } = stubDownload();

    render(<AdvancedActions settings={DEFAULT_SETTINGS} t={t} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Export sessions" }),
    );

    await waitFor(() => expect(blobs).toHaveLength(1));
    const parsed = JSON.parse(await blobs[0]!.text()) as {
      app: string;
      kind: string;
      sessions: Session[];
    };
    expect(parsed.app).toBe("savetabs");
    expect(parsed.kind).toBe("sessions");
    expect(parsed.sessions).toEqual([session]);
    expect(clicked[0]?.download).toBe("savetabs-sessions.json");
    expect(revoke).toHaveBeenCalledWith("blob:mock");
    expect(
      await screen.findByText("Exported savetabs-sessions.json."),
    ).toBeInTheDocument();
  });

  it("imports settings through the store", async () => {
    render(<AdvancedActions settings={DEFAULT_SETTINGS} t={t} />);

    importFile(
      "import-settings-input",
      settingsFile({
        ...DEFAULT_SETTINGS,
        "general.theme": "dark",
        "tabs.closeAfterSave": false,
      }),
    );

    expect(await screen.findByText("Settings imported.")).toBeInTheDocument();
    await waitFor(
      async () => {
        const stored = await fakeBrowser.storage.local.get("settings");
        expect((stored.settings as Settings)["general.theme"]).toBe("dark");
        expect((stored.settings as Settings)["tabs.closeAfterSave"]).toBe(
          false,
        );
      },
      { timeout: 2000 },
    );
  });

  it("keeps sync off when an imported file tries to enable it", async () => {
    render(<AdvancedActions settings={DEFAULT_SETTINGS} t={t} />);

    importFile(
      "import-settings-input",
      settingsFile({ ...DEFAULT_SETTINGS, "sync.enabled": true }),
    );

    expect(await screen.findByText("Settings imported.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Sync stays off after importing settings. Enable it from the toggle; that flow confirms your key.",
      ),
    ).toBeInTheDocument();
    await waitFor(async () => {
      const stored = await fakeBrowser.storage.local.get("settings");
      expect((stored.settings as Settings)["sync.enabled"]).toBe(false);
    });
  });

  it("rejects an invalid settings file with field errors", async () => {    render(<AdvancedActions settings={DEFAULT_SETTINGS} t={t} />);

    importFile(
      "import-settings-input",
      new File(
        [
          JSON.stringify({
            app: "savetabs",
            kind: "settings",
            version: 1,
            exportedAt: new Date().toISOString(),
            settings: { "general.theme": "neon" },
          }),
        ],
        "broken.json",
        { type: "application/json" },
      ),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Settings import failed:");
    expect(alert).toHaveTextContent("general.theme");
    await waitFor(async () => {
      const stored = await fakeBrowser.storage.local.get("settings");
      expect(stored.settings).toBeUndefined();
    });
  });

  it("adds new sessions and updates newer existing sessions", async () => {
    const existing = makeSession({
      id: "existing",
      createdAt: 1,
      updatedAt: 10,
      tabs: [{ url: "https://old.example", title: "Old" }],
    });
    await seedSessions([existing]);

    render(<AdvancedActions settings={DEFAULT_SETTINGS} t={t} />);

    const brandNew = makeSession({ id: "brand-new", updatedAt: 5 });
    importFile(
      "import-sessions-input",
      sessionsFile([
        {
          ...existing,
          updatedAt: 20,
          tabs: [{ url: "https://new.example", title: "New" }],
        },
        brandNew,
      ]),
    );

    expect(
      await screen.findByText("Imported 1 sessions and updated 1."),
    ).toBeInTheDocument();
    await waitFor(async () => {
      const sessions = await listSessions();
      expect(sessions.map((session) => session.id).sort()).toEqual([
        "brand-new",
        "existing",
      ]);
    });
    await expect(getSession("existing")).resolves.toMatchObject({
      updatedAt: 20,
      tabs: [{ url: "https://new.example", title: "New" }],
    });
    expect(
      screen.getByText("Storage used: 2 sessions, 2 tabs"),
    ).toBeInTheDocument();
  });

  it("keeps local-only flags when an imported copy omits them", async () => {
    const existing = makeSession({
      id: "flagged",
      createdAt: 1,
      updatedAt: 10,
      pendingUpload: true,
      incognito: true,
      syncExcluded: true,
      tabs: [{ url: "https://old.example", title: "Old" }],
    });
    await seedSessions([existing]);

    render(<AdvancedActions settings={DEFAULT_SETTINGS} t={t} />);

    importFile(
      "import-sessions-input",
      sessionsFile([
        {
          id: "flagged",
          createdAt: 1,
          updatedAt: 20,
          source: "window",
          tabs: [{ url: "https://new.example", title: "New" }],
        },
      ]),
    );

    expect(
      await screen.findByText("Imported 0 sessions and updated 1."),
    ).toBeInTheDocument();
    await expect(getSession("flagged")).resolves.toMatchObject({
      updatedAt: 20,
      pendingUpload: true,
      incognito: true,
      syncExcluded: true,
      tabs: [{ url: "https://new.example", title: "New" }],
    });
  });

  it("reports per-session quota failures without aborting the rest", async () => {
    await seedSessions(
      Array.from({ length: LIMITS.maxLocalSessions }, (_, index) => ({
        id: `seed-${index}`,
        createdAt: index + 1,
        updatedAt: index + 1,
        source: "window" as const,
        tabs: [],
      })),
    );

    render(<AdvancedActions settings={DEFAULT_SETTINGS} t={t} />);

    importFile(
      "import-sessions-input",
      sessionsFile([
        {
          id: "seed-0",
          createdAt: 1,
          updatedAt: 10,
          source: "window",
          tabs: [{ url: "https://updated.example", title: "Updated" }],
        },
        {
          id: "overflow",
          createdAt: 99,
          updatedAt: 99,
          source: "window",
          tabs: [{ url: "https://overflow.example", title: "Overflow" }],
        },
      ]),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Imported 0 sessions and updated 1. Some sessions could not be saved:",
    );
    expect(alert).toHaveTextContent("overflow");
    await expect(getSession("seed-0")).resolves.toMatchObject({
      updatedAt: 10,
      tabs: [{ url: "https://updated.example", title: "Updated" }],
    });
    await expect(getSession("overflow")).resolves.toBeUndefined();
  });

  it("resets settings only after confirmation and keeps sessions", async () => {
    const session = makeSession();
    await seedSessions([session]);
    await fakeBrowser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, "general.theme": "dark" },
    });

    render(<AdvancedActions settings={DEFAULT_SETTINGS} t={t} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Reset to defaults" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Reset all settings?" });
    expect(dialog).toHaveTextContent("Saved sessions are not affected.");

    await userEvent.click(
      screen.getByRole("button", { name: "Reset settings" }),
    );

    expect(
      await screen.findByText("Settings reset to defaults."),
    ).toBeInTheDocument();
    await waitFor(async () => {
      const stored = await fakeBrowser.storage.local.get("settings");
      expect(stored.settings).toEqual(DEFAULT_SETTINGS);
    });
    await expect(listSessions()).resolves.toEqual([session]);
  });

  it("does not reset settings when the dialog is cancelled", async () => {
    await fakeBrowser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, "general.theme": "dark" },
    });

    render(<AdvancedActions settings={DEFAULT_SETTINGS} t={t} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Reset to defaults" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const stored = await fakeBrowser.storage.local.get("settings");
    expect((stored.settings as Settings)["general.theme"]).toBe("dark");
  });

  it("clears local sessions only after confirmation", async () => {
    await seedSessions([makeSession(), makeSession()]);

    render(<AdvancedActions settings={DEFAULT_SETTINGS} t={t} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Clear local sessions" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Delete all local sessions?",
    });
    expect(dialog).toHaveTextContent("deleted permanently");

    await userEvent.click(
      screen.getByRole("button", { name: "Delete sessions" }),
    );

    expect(
      await screen.findByText("All local sessions deleted."),
    ).toBeInTheDocument();
    await waitFor(async () => expect(await listSessions()).toEqual([]));
    // A local clear must not write tombstones: cloud copies stay untouched.
    expect(await getTombstones()).toHaveLength(0);
    expect(
      await screen.findByText("Storage used: 0 sessions, 0 tabs"),
    ).toBeInTheDocument();
  });
});
