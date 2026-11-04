import { Hono, type Context } from "hono";
import { sha256Hex, timingSafeEqual } from "./auth";
import type { Env } from "./env";

interface KeyRow {
  key_hash: string;
}

interface SessionSummaryRow {
  id: string;
  updatedAt: number;
  size: number;
}

interface NewSession {
  bytes: Uint8Array;
  updatedAt: number;
}

type AppContext = Context<{ Bindings: Env }>;
type ExistingKeyAuth = { authId: string } | { response: Response };

const app = new Hono<{ Bindings: Env }>();

app.get("/v1/health", (c) => c.json({ ok: true }));

// Read-only key probe and session list. The full CRUD surface (get one,
// delete, tombstones, blobs, quotas) is added in Task 23.
app.get("/v1/keys/:authId/sessions", async (c) => {
  const auth = await authenticateExistingKey(c, c.req.param("authId"));
  if ("response" in auth) return auth.response;

  const { results } = await c.env.DB.prepare(
    `SELECT session_id AS id, updated_at AS updatedAt, size
       FROM sessions
      WHERE auth_id = ?
      ORDER BY updated_at DESC`,
  )
    .bind(auth.authId)
    .all<SessionSummaryRow>();

  return c.json({ sessions: results });
});

app.put("/v1/keys/:authId/sessions/:sessionId", async (c) => {
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

  const session = await readSessionBody(c);
  if (session === null) return invalidRequest(c);

  const now = Date.now();
  let status: 200 | 201 = 200;

  if (existingKey === null) {
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
    } else {
      const racedKey = await loadKey(c.env.DB, authId);
      if (racedKey === null || !timingSafeEqual(racedKey.key_hash, keyHash)) {
        return unauthorized(c);
      }
    }
  }

  await c.env.DB.prepare("UPDATE keys SET last_seen_at = ? WHERE auth_id = ?")
    .bind(now, authId)
    .run();

  await c.env.DB.prepare(
    `INSERT INTO sessions (auth_id, session_id, ciphertext, updated_at, size)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (auth_id, session_id) DO UPDATE SET
       ciphertext = excluded.ciphertext,
       updated_at = excluded.updated_at,
       size = excluded.size`,
  )
    .bind(
      authId,
      sessionId,
      session.bytes,
      session.updatedAt,
      session.bytes.byteLength,
    )
    .run();

  return c.json({ ok: true }, status);
});

/** Route an existing key through bearer auth; unknown keys are 404. */
async function authenticateExistingKey(
  c: AppContext,
  authId: string,
): Promise<ExistingKeyAuth> {
  const bearer = parseBearer(c.req.header("authorization"));
  if (bearer === null) return { response: unauthorized(c) };

  const key = await loadKey(c.env.DB, authId);
  if (key === null) return { response: notFound(c) };

  const keyHash = await sha256Hex(bearer);
  if (!timingSafeEqual(key.key_hash, keyHash)) {
    return { response: unauthorized(c) };
  }
  return { authId };
}

function loadKey(db: D1Database, authId: string): Promise<KeyRow | null> {
  return db
    .prepare("SELECT key_hash FROM keys WHERE auth_id = ?")
    .bind(authId)
    .first<KeyRow>();
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

  const bytes = decodeBase64Url(ciphertext);
  if (bytes === null || bytes.byteLength === 0) return null;

  return { bytes, updatedAt };
}

/** Decode unpadded base64url (RFC 4648 §5), rejecting foreign characters. */
function decodeBase64Url(value: string): Uint8Array | null {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/=+$/, "");

  if (normalized.length === 0 || normalized.length % 4 === 1) return null;
  if (!/^[A-Za-z0-9+/]+$/.test(normalized)) return null;

  try {
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function unauthorized(c: AppContext) {
  return c.json(
    { error: { code: "unauthorized", message: "A valid bearer token is required." } },
    401,
  );
}

function notFound(c: AppContext) {
  return c.json(
    { error: { code: "not_found", message: "Sync key not found." } },
    404,
  );
}

function invalidRequest(c: AppContext) {
  return c.json(
    {
      error: {
        code: "invalid_request",
        message:
          "Body must include a base64url ciphertext and a finite updatedAt.",
      },
    },
    400,
  );
}

export default app;
