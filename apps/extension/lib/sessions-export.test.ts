import type { Session } from "@savetabs/shared";
import { describe, expect, it } from "vitest";

import { exportSessionsFile, importSessionsFile } from "./sessions-export";

const NOW = 10_000;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-a",
    createdAt: 1,
    updatedAt: 2,
    source: "window",
    tabs: [{ url: "https://example.com", title: "Example" }],
    ...overrides,
  };
}

function sessionsFile(sessions: unknown, header: object = {}): string {
  return JSON.stringify({
    app: "savetabs",
    kind: "sessions",
    version: 1,
    exportedAt: new Date().toISOString(),
    ...header,
    sessions,
  });
}

describe("exportSessionsFile", () => {
  it("writes the documented plaintext header and the sessions", () => {
    const session = makeSession();

    const parsed = JSON.parse(exportSessionsFile([session])) as {
      app: unknown;
      kind: unknown;
      version: unknown;
      exportedAt: unknown;
      sessions: unknown;
    };

    expect(parsed.app).toBe("savetabs");
    expect(parsed.kind).toBe("sessions");
    expect(parsed.version).toBe(1);
    expect(typeof parsed.exportedAt).toBe("string");
    expect(new Date(parsed.exportedAt as string).toISOString()).toBe(
      parsed.exportedAt,
    );
    expect(parsed.sessions).toEqual([session]);
  });
});

describe("importSessionsFile", () => {
  it("round-trips every session field", () => {
    const session = makeSession({
      id: "full-session",
      title: "Work",
      pendingUpload: true,
      incognito: true,
      tabs: [
        {
          url: "https://example.com/a",
          title: "A",
          favIconUrl: "data:image/png;base64,AAAA",
          pinned: true,
        },
      ],
    });

    expect(
      importSessionsFile(exportSessionsFile([session]), [], NOW),
    ).toEqual({ ok: true, merged: [session] });
  });

  it("merges newer imported sessions and keeps local-only sessions", () => {
    const sharedLocal = makeSession({
      id: "shared",
      updatedAt: 1,
      tabs: [{ url: "https://local.example", title: "Local" }],
    });
    const localOnly = makeSession({ id: "local-only", updatedAt: 5 });
    const sharedRemote = makeSession({
      id: "shared",
      updatedAt: 2,
      tabs: [{ url: "https://remote.example", title: "Remote" }],
    });
    const remoteOnly = makeSession({ id: "remote-only", updatedAt: 3 });

    const result = importSessionsFile(
      sessionsFile([sharedRemote, remoteOnly]),
      [sharedLocal, localOnly],
      NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.merged.map((session) => session.id)).toEqual([
        "shared",
        "local-only",
        "remote-only",
      ]);
      expect(result.merged[0]?.tabs[0]?.url).toBe("https://remote.example");
      expect(result.merged[1]).toEqual(localOnly);
    }
  });

  it("keeps the local copy when the imported copy is older or equal", () => {
    const local = makeSession({
      id: "shared",
      updatedAt: 5,
      tabs: [{ url: "https://local.example", title: "Local" }],
    });

    const older = importSessionsFile(
      sessionsFile([makeSession({ id: "shared", updatedAt: 4 })]),
      [local],
      NOW,
    );
    const equal = importSessionsFile(
      sessionsFile([makeSession({ id: "shared", updatedAt: 5 })]),
      [local],
      NOW,
    );

    expect(older.ok && older.merged[0]).toEqual(local);
    expect(equal.ok && equal.merged[0]).toEqual(local);
  });

  it("drops tabs whose URL cannot be restored", () => {
    const tabs = [
      { url: "https://ok.example/a", title: "HTTPS" },
      { url: "http://ok.example/b", title: "HTTP" },
      { url: "file:///tmp/local.html", title: "File" },
      { url: "chrome://settings", title: "Chrome" },
      { url: "javascript:alert(1)", title: "Script" },
      { url: "about:blank", title: "About" },
      { url: "ftp://files.example/x", title: "FTP" },
      { url: "not a url", title: "Garbage" },
      { title: "Missing URL" },
      { url: 42, title: "Wrong type" },
      { url: "https://ok.example/title", title: 7 },
    ];

    const result = importSessionsFile(
      sessionsFile([
        { id: "filtered", createdAt: 1, updatedAt: 2, source: "window", tabs },
      ]),
      [],
      NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const kept = result.merged[0];
      expect(kept?.tabs.map((tab) => tab.url)).toEqual([
        "https://ok.example/a",
        "http://ok.example/b",
        "file:///tmp/local.html",
        "https://ok.example/title",
      ]);
      expect(kept?.tabs[3]?.title).toBe("");
    }
  });

  it("keeps a session whose tabs were all malformed as an empty session", () => {
    const result = importSessionsFile(
      sessionsFile([
        {
          id: "empty",
          createdAt: 1,
          updatedAt: 2,
          source: "tab",
          tabs: [{ url: "chrome://newtab" }],
        },
      ]),
      [],
      NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.merged[0]?.tabs).toEqual([]);
  });

  it("rejects malformed JSON and wrong headers", () => {
    expect(importSessionsFile("{not json", [], NOW).ok).toBe(false);
    expect(importSessionsFile(JSON.stringify([]), [], NOW).ok).toBe(false);
    expect(
      importSessionsFile(sessionsFile([], { app: "other" }), [], NOW).ok,
    ).toBe(false);
    expect(
      importSessionsFile(sessionsFile([], { kind: "settings" }), [], NOW).ok,
    ).toBe(false);
    expect(
      importSessionsFile(sessionsFile([], { version: 2 }), [], NOW).ok,
    ).toBe(false);
    expect(
      importSessionsFile(
        JSON.stringify({
          app: "savetabs",
          kind: "sessions",
          version: 1,
          sessions: "nope",
        }),
        [],
        NOW,
      ).ok,
    ).toBe(false);
  });

  it("rejects sessions with an invalid shape and merges nothing", () => {
    const result = importSessionsFile(
      sessionsFile([
        { id: "", createdAt: "yesterday", updatedAt: -1, source: "popup", tabs: "no" },
        "not an object",
      ]),
      [makeSession()],
      NOW,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining("sessions[0].id"),
          expect.stringContaining("sessions[0].createdAt"),
          expect.stringContaining("sessions[0].updatedAt"),
          expect.stringContaining("sessions[0].source"),
          expect.stringContaining("sessions[0].tabs"),
          expect.stringContaining("sessions[1]"),
        ]),
      );
    }
    expect(result).not.toHaveProperty("merged");
  });

  it("does not mutate the existing or imported arrays", () => {
    const existing = [makeSession({ id: "local", updatedAt: 1 })];
    const imported = [makeSession({ id: "local", updatedAt: 2 })];
    const existingBefore = structuredClone(existing);
    const importedBefore = structuredClone(imported);

    importSessionsFile(exportSessionsFile(imported), existing, NOW);

    expect(existing).toEqual(existingBefore);
    expect(imported).toEqual(importedBefore);
  });
});
