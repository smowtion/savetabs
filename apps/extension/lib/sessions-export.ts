/**
 * Plaintext session file import and export.
 *
 * Bulk export is the recovery path when the sync key is lost, so sessions are
 * written without encryption. Import validates the envelope and every session,
 * silently drops tabs whose URL cannot be restored (only http, https and file
 * URLs are kept), and merges with the local sessions using the shared
 * last-write-wins rules. This module is pure: persisting the merged list is the
 * caller's responsibility.
 */

import {
  mergeSessions,
  type SavedTab,
  type Session,
  type SessionSource,
} from "@savetabs/shared";

export const SESSIONS_FILE_APP = "savetabs";
export const SESSIONS_FILE_KIND = "sessions";
export const SESSIONS_FILE_VERSION = 1;

const SESSION_SOURCES: readonly SessionSource[] = [
  "window",
  "all-windows",
  "tab",
  "selection",
];

const RESTORABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  "http:",
  "https:",
  "file:",
]);

export type SessionsFile = {
  app: typeof SESSIONS_FILE_APP;
  kind: typeof SESSIONS_FILE_KIND;
  version: typeof SESSIONS_FILE_VERSION;
  /** ISO 8601 timestamp of the export. */
  exportedAt: string;
  sessions: Session[];
};

export type SessionsImportResult =
  | { ok: true; merged: Session[] }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isSessionSource(value: unknown): value is SessionSource {
  return (
    typeof value === "string" &&
    (SESSION_SOURCES as readonly string[]).includes(value)
  );
}

/** Serialize sessions into the documented plaintext sessions-file format. */
export function exportSessionsFile(sessions: readonly Session[]): string {
  const file: SessionsFile = {
    app: SESSIONS_FILE_APP,
    kind: SESSIONS_FILE_KIND,
    version: SESSIONS_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    sessions: [...sessions],
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Keep the fields of a tab that can be restored. Returns undefined when the
 * URL is missing or its scheme is not restorable, which drops the tab.
 */
function sanitizeTab(raw: unknown): SavedTab | undefined {
  if (!isRecord(raw) || typeof raw.url !== "string") return undefined;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(raw.url);
  } catch {
    return undefined;
  }
  if (!RESTORABLE_PROTOCOLS.has(parsedUrl.protocol)) return undefined;

  const tab: SavedTab = {
    url: raw.url,
    title: typeof raw.title === "string" ? raw.title : "",
  };
  if (typeof raw.favIconUrl === "string") tab.favIconUrl = raw.favIconUrl;
  if (typeof raw.pinned === "boolean") tab.pinned = raw.pinned;
  return tab;
}

/**
 * Validate one session entry, collecting field errors. Returns undefined when
 * the required shape is invalid; tabs with unrestorable URLs are dropped from
 * otherwise valid sessions.
 */
function sanitizeSession(
  raw: unknown,
  index: number,
  errors: string[],
): Session | undefined {
  const prefix = `sessions[${index}]`;
  if (!isRecord(raw)) {
    errors.push(`${prefix}: must be an object`);
    return undefined;
  }

  const id =
    typeof raw.id === "string" && raw.id.length > 0 ? raw.id : undefined;
  if (id === undefined) {
    errors.push(`${prefix}.id: must be a non-empty string`);
  }

  const createdAt = isTimestamp(raw.createdAt) ? raw.createdAt : undefined;
  if (createdAt === undefined) {
    errors.push(`${prefix}.createdAt: must be a non-negative epoch timestamp`);
  }

  const updatedAt = isTimestamp(raw.updatedAt) ? raw.updatedAt : undefined;
  if (updatedAt === undefined) {
    errors.push(`${prefix}.updatedAt: must be a non-negative epoch timestamp`);
  }

  const source = isSessionSource(raw.source) ? raw.source : undefined;
  if (source === undefined) {
    errors.push(
      `${prefix}.source: must be one of: ${SESSION_SOURCES.join(", ")}`,
    );
  }

  const rawTabs = Array.isArray(raw.tabs) ? raw.tabs : undefined;
  if (rawTabs === undefined) {
    errors.push(`${prefix}.tabs: must be an array`);
  }

  if (
    id === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    source === undefined ||
    rawTabs === undefined
  ) {
    return undefined;
  }

  const tabs = rawTabs
    .map(sanitizeTab)
    .filter((tab): tab is SavedTab => tab !== undefined);

  const session: Session = { id, createdAt, updatedAt, source, tabs };
  if (typeof raw.title === "string") session.title = raw.title;
  if (typeof raw.pendingUpload === "boolean") {
    session.pendingUpload = raw.pendingUpload;
  }
  if (typeof raw.incognito === "boolean") session.incognito = raw.incognito;
  return session;
}

/**
 * Validate a sessions file and merge it over `existing`.
 *
 * The merge is last-write-wins by `updatedAt` with the local copy winning
 * ties. Invalid entries reject the whole file, so a malformed file never
 * merges partially. Nothing is written to storage here.
 */
export function importSessionsFile(
  text: string,
  existing: readonly Session[],
  now: number,
): SessionsImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["File is not valid JSON"] };
  }

  if (!isRecord(parsed)) {
    return { ok: false, errors: ["File must be a JSON object"] };
  }

  const errors: string[] = [];
  if (parsed.app !== SESSIONS_FILE_APP) {
    errors.push(`app must be "${SESSIONS_FILE_APP}"`);
  }
  if (parsed.kind !== SESSIONS_FILE_KIND) {
    errors.push(`kind must be "${SESSIONS_FILE_KIND}"`);
  }
  if (parsed.version !== SESSIONS_FILE_VERSION) {
    errors.push(`version must be ${SESSIONS_FILE_VERSION}`);
  }
  if (!Array.isArray(parsed.sessions)) {
    errors.push("sessions must be an array");
  }
  if (errors.length > 0) return { ok: false, errors };

  const imported: Session[] = [];
  (parsed.sessions as unknown[]).forEach((raw, index) => {
    const session = sanitizeSession(raw, index, errors);
    if (session !== undefined) imported.push(session);
  });
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, merged: mergeSessions(existing, imported, [], now) };
}
