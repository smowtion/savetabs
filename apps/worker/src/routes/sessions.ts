import { Hono } from "hono";
import { fromBase64Url, toBase64Url } from "@savetabs/shared/base64url";
import { sha256Hex, timingSafeEqual } from "../auth";
import {
  DEFAULT_MAX_KEYS,
  enforceAuthRateLimit,
  keysCreatedToday,
  parseLimit,
  recordKeyCreated,
} from "../counters";
import type { Env } from "../env";
import { apiError, type AppContext } from "../errors";
import { checkPayloadSize, checkSessionQuota } from "../quota";

interface KeyRow {
  key_hash: string;
}

interface SessionSummaryRow {
  id: string;
  updatedAt: number;
  size: number;
}

type StoredBlob = ArrayBuffer | ArrayBufferView | number[];

interface SessionBlobRow {
  id: string;
  ciphertext: StoredBlob;
  updatedAt: number;
}

interface NewSession {
  bytes: Uint8Array;
  updatedAt: number;
}

/** The stored timestamps that decide whether an incoming PUT may land. */
interface WriteState {
  sessionUpdatedAt?: number;
  deletedAt?: number;
}

type ExistingKeyAuth = { authId: string } | { response: Response };

/** Tombstones are kept for 30 days so other devices can observe deletes. */
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 50;

export const sessionsRoutes = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Session resources
// ---------------------------------------------------------------------------

sessionsRoutes.get("/keys/:authId/sessions", async (c) => {
  const auth = await authenticateExistingKey(c, c.req.param("authId"));
  if ("response" in auth) return auth.response;

  const { results } = await c.env.DB.prepare(
    `SELECT session_id AS id, updated_at AS updatedAt, size
       FROM sessions
      WHERE auth_id = ?
      ORDER BY updated_at DESC, session_id ASC`,
  )
    .bind(auth.authId)
    .all<SessionSummaryRow>();

  return c.json({ sessions: results });
});

sessionsRoutes.get("/keys/:authId/sessions/:sessionId", async (c) => {
  const auth = await authenticateExistingKey(c, c.req.param("authId"));
  if ("response" in auth) return auth.response;

  const row = await c.env.DB.prepare(
    `SELECT session_id AS id, ciphertext, updated_at AS updatedAt
       FROM sessions
      WHERE auth_id = ? AND session_id = ?`,
  )
    .bind(auth.authId, c.req.param("sessionId"))
    .first<SessionBlobRow>();

  if (row === null) {
    return apiError(c, 404, "not_found", "Session not found.");
  }

  return c.json({
    id: row.id,
    ciphertext: toBase64Url(toBytes(row.ciphertext)),
    updatedAt: row.updatedAt,
  });
});

sessionsRoutes.put("/keys/:authId/sessions/:sessionId", async (c) => {
  const bearer = parseBearer(c.req.header("authorization"));
  if (bearer === null) return unauthorized(c);

  const authId = c.req.param("authId");
  const sessionId = c.req.param("sessionId");
  const keyHash = await sha256Hex(bearer);

  // An already-registered key must match before the body is considered.
  const existingKey = await loadKey(c.env.DB, authId);
  if (existingKey !== null && !timingSafeEqual(existingKey.key_hash, keyHash)) {
    return unauthorized(c);
  }

  // The bearer has been verified for an existing key, so charge its bucket
  // before doing any further work. Auto-registration charges it below, after
  // the new key row is established.
  if (existingKey !== null) {
    const limited = await enforceAuthRateLimit(c, authId);
    if (limited !== null) return limited;
  }

  const session = await readSessionBody(c);
  if (session === null) return invalidRequest(c);

  const sizeRejection = checkPayloadSize(session.bytes.byteLength);
  if (sizeRejection !== null) {
    return apiError(
      c,
      sizeRejection.status,
      sizeRejection.code,
      sizeRejection.message,
    );
  }

  // A tombstone or a newer stored copy wins over this write. Answering 200
  // lets the client clear its pending flag; the next sync reconciles it with
  // the winning state instead of resurrecting deleted data.
  const current = await loadWriteState(c.env.DB, authId, sessionId);
  if (isStaleWrite(current, session.updatedAt)) {
    return c.json({ ok: true });
  }

  const quotaRejection = await checkSessionQuota(
    c.env.DB,
    authId,
    sessionId,
    session.bytes.byteLength,
  );
  if (quotaRejection !== null) {
    return apiError(
      c,
      quotaRejection.status,
      quotaRejection.code,
      quotaRejection.message,
    );
  }

  const now = Date.now();
  let status: 200 | 201 = 200;

  if (existingKey === null) {
    const maxKeys = parseLimit(c.env.GLOBAL_MAX_KEYS, DEFAULT_MAX_KEYS);
    if ((await keysCreatedToday(c.env.DB, now)) >= maxKeys) {
      return apiError(
        c,
        429,
        "capacity_exceeded",
        "The global key capacity has been reached.",
      );
    }

    // First PUT for this authId: auto-register the key. OR IGNORE keeps two
    // concurrent first uploads from racing into a unique-constraint error.
    const inserted = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO keys (auth_id, key_hash, created_at, last_seen_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(authId, keyHash, now, now)
      .run();

    if ((inserted.meta.changes ?? 0) > 0) {
      status = 201;
      await recordKeyCreated(c.env.DB, now);
    } else {
      const racedKey = await loadKey(c.env.DB, authId);
      if (racedKey === null || !timingSafeEqual(racedKey.key_hash, keyHash)) {
        return unauthorized(c);
      }
    }

    // The bearer now owns this authId; charge its bucket before writing.
    const limited = await enforceAuthRateLimit(c, authId);
    if (limited !== null) return limited;
  }

  // Session upsert and last-seen bump are atomic: either both land or neither.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE keys SET last_seen_at = ? WHERE auth_id = ?",
    ).bind(now, authId),
    c.env.DB.prepare(
      `INSERT INTO sessions (auth_id, session_id, ciphertext, updated_at, size)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (auth_id, session_id) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         updated_at = excluded.updated_at,
         size = excluded.size`,
    ).bind(
      authId,
      sessionId,
      session.bytes,
      session.updatedAt,
      session.bytes.byteLength,
    ),
  ]);

  return c.json({ ok: true }, status);
});

sessionsRoutes.delete("/keys/:authId/sessions/:sessionId", async (c) => {
  const auth = await authenticateExistingKey(c, c.req.param("authId"));
  if ("response" in auth) return auth.response;

  const now = Date.now();
  const cutoff = now - TOMBSTONE_TTL_MS;

  // Delete and tombstone land together; the prune keeps the tombstone table
  // bounded without ever removing a tombstone younger than 30 days.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM sessions WHERE auth_id = ? AND session_id = ?",
    ).bind(auth.authId, c.req.param("sessionId")),
    c.env.DB.prepare(
      `INSERT INTO deletions (auth_id, session_id, deleted_at)
       VALUES (?, ?, ?)
       ON CONFLICT (auth_id, session_id) DO UPDATE SET
         deleted_at = excluded.deleted_at`,
    ).bind(auth.authId, c.req.param("sessionId"), now),
    c.env.DB.prepare("DELETE FROM deletions WHERE deleted_at < ?").bind(cutoff),
  ]);

  return c.body(null, 204);
});

sessionsRoutes.delete("/keys/:authId", async (c) => {
  const auth = await authenticateExistingKey(c, c.req.param("authId"));
  if ("response" in auth) return auth.response;

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE auth_id = ?").bind(auth.authId),
    c.env.DB.prepare("DELETE FROM deletions WHERE auth_id = ?").bind(
      auth.authId,
    ),
    c.env.DB.prepare("DELETE FROM keys WHERE auth_id = ?").bind(auth.authId),
  ]);

  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Bulk download and tombstones
// ---------------------------------------------------------------------------

sessionsRoutes.get("/keys/:authId/blobs", async (c) => {
  const auth = await authenticateExistingKey(c, c.req.param("authId"));
  if ("response" in auth) return auth.response;

  const page = parsePage(c.req.query("page"));
  const pageSize = parsePageSize(c.req.query("pageSize"));

  // Fetch one extra row to learn whether a further page exists without a
  // second query. `session_id` breaks `updated_at` ties so pages are stable.
  const { results } = await c.env.DB.prepare(
    `SELECT session_id AS id, ciphertext, updated_at AS updatedAt
       FROM sessions
      WHERE auth_id = ?
      ORDER BY updated_at DESC, session_id ASC
      LIMIT ? OFFSET ?`,
  )
    .bind(auth.authId, pageSize + 1, page * pageSize)
    .all<SessionBlobRow>();

  const hasMore = results.length > pageSize;
  const blobs = results.slice(0, pageSize).map((row) => ({
    id: row.id,
    ciphertext: toBase64Url(toBytes(row.ciphertext)),
    updatedAt: row.updatedAt,
  }));

  return c.json(hasMore ? { blobs, nextPage: page + 1 } : { blobs });
});

sessionsRoutes.get("/keys/:authId/deletions", async (c) => {
  const auth = await authenticateExistingKey(c, c.req.param("authId"));
  if ("response" in auth) return auth.response;

  const { results } = await c.env.DB.prepare(
    `SELECT session_id AS id, deleted_at AS deletedAt
       FROM deletions
      WHERE auth_id = ?
      ORDER BY deleted_at DESC, session_id ASC`,
  )
    .bind(auth.authId)
    .all<{ id: string; deletedAt: number }>();

  return c.json({ deletions: results });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Route an existing key through bearer auth; unknown keys are 404. */
async function authenticateExistingKey(
  c: AppContext,
  authId: string,
): Promise<ExistingKeyAuth> {
  const bearer = parseBearer(c.req.header("authorization"));
  if (bearer === null) return { response: unauthorized(c) };

  const key = await loadKey(c.env.DB, authId);
  if (key === null) {
    return { response: apiError(c, 404, "not_found", "Sync key not found.") };
  }

  const keyHash = await sha256Hex(bearer);
  if (!timingSafeEqual(key.key_hash, keyHash)) {
    return { response: unauthorized(c) };
  }

  const limited = await enforceAuthRateLimit(c, authId);
  if (limited !== null) return { response: limited };

  return { authId };
}

function loadKey(db: D1Database, authId: string): Promise<KeyRow | null> {
  return db
    .prepare("SELECT key_hash FROM keys WHERE auth_id = ?")
    .bind(authId)
    .first<KeyRow>();
}

/**
 * Read the timestamps a PUT has to beat: the stored session's `updated_at`
 * and any tombstone for the same id. Either may be absent.
 */
async function loadWriteState(
  db: D1Database,
  authId: string,
  sessionId: string,
): Promise<WriteState> {
  const session = await db
    .prepare(
      "SELECT updated_at AS updatedAt FROM sessions WHERE auth_id = ? AND session_id = ?",
    )
    .bind(authId, sessionId)
    .first<{ updatedAt: number }>();
  const deletion = await db
    .prepare(
      "SELECT deleted_at AS deletedAt FROM deletions WHERE auth_id = ? AND session_id = ?",
    )
    .bind(authId, sessionId)
    .first<{ deletedAt: number }>();

  const state: WriteState = {};
  if (session !== null) state.sessionUpdatedAt = session.updatedAt;
  if (deletion !== null) state.deletedAt = deletion.deletedAt;
  return state;
}

/**
 * A write is stale when a tombstone is at least as new as the incoming
 * `updatedAt`, or when the stored copy is strictly newer. Last-write-wins
 * still allows a session updated after its deletion to exist again.
 */
function isStaleWrite(state: WriteState, updatedAt: number): boolean {
  if (state.deletedAt !== undefined && state.deletedAt >= updatedAt) {
    return true;
  }
  return (
    state.sessionUpdatedAt !== undefined && state.sessionUpdatedAt > updatedAt
  );
}

/** Parse `Authorization: Bearer <token>`; anything else is malformed. */
function parseBearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

async function readSessionBody(c: AppContext): Promise<NewSession | null> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const { ciphertext, updatedAt } = value as Record<string, unknown>;
  if (typeof ciphertext !== "string" || ciphertext.length === 0) return null;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;

  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(ciphertext);
  } catch {
    return null;
  }
  if (bytes.byteLength === 0) return null;

  return { bytes, updatedAt };
}

/** D1 may hand blobs back as ArrayBuffer, a typed-array view or a number[]. */
function toBytes(value: StoredBlob): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

/** Page defaults to 0; malformed values are clamped instead of rejected. */
function parsePage(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  // A page this large is always empty for a key capped at 200 sessions, and
  // the bound keeps `page * pageSize` a safe integer for D1.
  return Math.min(1_000_000, Math.max(0, Math.floor(value)));
}

/** Page size defaults to 50 and is clamped to 1..50. */
function parsePageSize(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PAGE_SIZE;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

function unauthorized(c: AppContext) {
  return apiError(
    c,
    401,
    "unauthorized",
    "A valid bearer token is required.",
  );
}

function invalidRequest(c: AppContext) {
  return apiError(
    c,
    400,
    "invalid_request",
    "Body must include a base64url ciphertext and a finite updatedAt.",
  );
}