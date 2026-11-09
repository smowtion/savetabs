import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { toBase64Url } from "@savetabs/shared/base64url";
import { LIMITS } from "@savetabs/shared/constants";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { sha256Hex } from "../src/auth";
import { currentDay } from "../src/counters";

const BASE_URL = "https://savetabs.test";
const AUTH_KEY = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA";
const SMALL_CIPHERTEXT = "AQIDBAUG";

interface ErrorBody {
  error: { code: string; message: string };
}

interface SessionSummary {
  id: string;
  updatedAt: number;
  size: number;
}

interface BlobRow {
  id: string;
  ciphertext: string;
  updatedAt: number;
}

interface DeletionRow {
  id: string;
  deletedAt: number;
}

function bearerHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return { Authorization: `Bearer ${AUTH_KEY}`, ...extra };
}

function jsonHeaders(): Record<string, string> {
  return bearerHeaders({ "content-type": "application/json" });
}

function putSession(
  authId: string,
  sessionId: string,
  body: { ciphertext: string; updatedAt: number } = {
    ciphertext: SMALL_CIPHERTEXT,
    updatedAt: 1_000,
  },
): Promise<Response> {
  return SELF.fetch(
    `${BASE_URL}/v1/keys/${authId}/sessions/${sessionId}`,
    {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    },
  );
}

function deleteSession(authId: string, sessionId: string): Promise<Response> {
  return SELF.fetch(
    `${BASE_URL}/v1/keys/${authId}/sessions/${sessionId}`,
    { method: "DELETE", headers: bearerHeaders() },
  );
}

function deleteKey(authId: string): Promise<Response> {
  return SELF.fetch(`${BASE_URL}/v1/keys/${authId}`, {
    method: "DELETE",
    headers: bearerHeaders(),
  });
}

function getJson(
  path: string,
  headers: Record<string, string> = bearerHeaders(),
): Promise<Response> {
  return SELF.fetch(`${BASE_URL}${path}`, { headers });
}

async function seedKey(authId: string): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO keys (auth_id, key_hash, created_at, last_seen_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(authId, await sha256Hex(AUTH_KEY), now, now)
    .run();
}

interface SeedSession {
  id: string;
  size: number;
  updatedAt?: number;
}

/**
 * Insert sessions directly: quota checks read the stored `size` column, so
 * fixtures only need that column to be realistic.
 */
async function seedSessions(
  authId: string,
  rows: readonly SeedSession[],
): Promise<void> {
  await seedKey(authId);
  for (let start = 0; start < rows.length; start += 50) {
    const chunk = rows.slice(start, start + 50);
    await env.DB.batch(
      chunk.map((row, index) =>
        env.DB.prepare(
          `INSERT INTO sessions (auth_id, session_id, ciphertext, updated_at, size)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(
          authId,
          row.id,
          new Uint8Array([start + index]),
          row.updatedAt ?? 1_000,
          row.size,
        ),
      ),
    );
  }
}

function readSession(
  authId: string,
  sessionId: string,
): Promise<{ size: number; updated_at: number } | null> {
  return env.DB.prepare(
    "SELECT size, updated_at FROM sessions WHERE auth_id = ? AND session_id = ?",
  )
    .bind(authId, sessionId)
    .first<{ size: number; updated_at: number }>();
}

function readKey(authId: string): Promise<{ auth_id: string } | null> {
  return env.DB.prepare("SELECT auth_id FROM keys WHERE auth_id = ?")
    .bind(authId)
    .first<{ auth_id: string }>();
}

async function countRows(
  table: "keys" | "sessions" | "deletions",
  authId: string,
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ${table} WHERE auth_id = ?`,
  )
    .bind(authId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function resetCounters(): Promise<void> {
  await env.DB.prepare("DELETE FROM counters WHERE day = ?")
    .bind(currentDay())
    .run();
}

async function seedCounter(options: {
  requests: number;
  keysCreated: number;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO counters (day, requests, keys_created) VALUES (?, ?, ?)
     ON CONFLICT (day) DO UPDATE SET
       requests = excluded.requests,
       keys_created = excluded.keys_created`,
  )
    .bind(currentDay(), options.requests, options.keysCreated)
    .run();
}

describe("sessions CRUD", () => {
  it("CRUDs and tombstones deletes", async () => {
    const authId = "crud";
    const ciphertext = toBase64Url(new Uint8Array([9, 8, 7, 6]));

    expect(
      (
        await putSession(authId, "session-1", {
          ciphertext,
          updatedAt: 1_710_000_000_000,
        })
      ).status,
    ).toBe(201);

    const listResponse = await getJson(`/v1/keys/${authId}/sessions`);
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({
      sessions: [{ id: "session-1", updatedAt: 1_710_000_000_000, size: 4 }],
    });

    const getResponse = await getJson(
      `/v1/keys/${authId}/sessions/session-1`,
    );
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({
      id: "session-1",
      ciphertext,
      updatedAt: 1_710_000_000_000,
    });

    expect((await deleteSession(authId, "session-1")).status).toBe(204);

    const emptyList = await getJson(`/v1/keys/${authId}/sessions`);
    expect(await emptyList.json()).toEqual({ sessions: [] });

    const missing = await getJson(`/v1/keys/${authId}/sessions/session-1`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ErrorBody).error.code).toBe("not_found");

    const deletionsResponse = await getJson(`/v1/keys/${authId}/deletions`);
    expect(deletionsResponse.status).toBe(200);
    const deletions = (await deletionsResponse.json()) as {
      deletions: DeletionRow[];
    };
    expect(deletions.deletions).toHaveLength(1);
    expect(deletions.deletions[0]?.id).toBe("session-1");
    expect(deletions.deletions[0]?.deletedAt).toBeGreaterThan(0);

    expect(await readSession(authId, "session-1")).toBeNull();
    expect(await countRows("deletions", authId)).toBe(1);
  });

  it("deletes every row for a key", async () => {
    const authId = "delete-key";
    expect((await putSession(authId, "s1")).status).toBe(201);
    expect((await deleteSession(authId, "s1")).status).toBe(204);

    expect((await deleteKey(authId)).status).toBe(204);

    expect(await countRows("keys", authId)).toBe(0);
    expect(await countRows("sessions", authId)).toBe(0);
    expect(await countRows("deletions", authId)).toBe(0);

    expect((await deleteKey(authId)).status).toBe(404);
  });

  it("fails closed with the error envelope for unknown keys, bad bearers and unknown routes", async () => {
    const unknownKey = await getJson("/v1/keys/nobody/sessions");
    expect(unknownKey.status).toBe(404);
    expect(((await unknownKey.json()) as ErrorBody).error.code).toBe(
      "not_found",
    );

    expect((await putSession("wrong-bearer", "s1")).status).toBe(201);
    const wrongBearer = await SELF.fetch(
      `${BASE_URL}/v1/keys/wrong-bearer/sessions`,
      { headers: bearerHeaders({ Authorization: "Bearer nope" }) },
    );
    expect(wrongBearer.status).toBe(401);
    expect(((await wrongBearer.json()) as ErrorBody).error.code).toBe(
      "unauthorized",
    );

    const unknownRoute = await SELF.fetch(`${BASE_URL}/v1/does-not-exist`);
    expect(unknownRoute.status).toBe(404);
    expect(((await unknownRoute.json()) as ErrorBody).error.code).toBe(
      "not_found",
    );
  });
});

describe("GET /v1/keys/:authId/sessions/:id", () => {
  it("rejects wrong bearers and missing sessions", async () => {
    const authId = "get-one";
    expect((await putSession(authId, "s1")).status).toBe(201);

    const wrongBearer = await SELF.fetch(
      `${BASE_URL}/v1/keys/${authId}/sessions/s1`,
      { headers: { Authorization: "Bearer wrong" } },
    );
    expect(wrongBearer.status).toBe(401);

    const missing = await getJson(`/v1/keys/${authId}/sessions/nope`);
    expect(missing.status).toBe(404);
  });
});

describe("GET /v1/keys/:authId/blobs", () => {
  it("serves blobs in pages of 50", async () => {
    const authId = "blobs";
    for (let index = 1; index <= 60; index += 1) {
      const response = await putSession(authId, `s${index}`, {
        ciphertext: toBase64Url(new Uint8Array([index])),
        updatedAt: index,
      });
      expect(response.status).toBe(index === 1 ? 201 : 200);
    }

    const firstResponse = await getJson(`/v1/keys/${authId}/blobs`);
    expect(firstResponse.status).toBe(200);
    const firstPage = (await firstResponse.json()) as {
      blobs: BlobRow[];
      nextPage?: number;
    };
    expect(firstPage.blobs).toHaveLength(50);
    expect(firstPage.nextPage).toBe(1);
    expect(firstPage.blobs[0]).toEqual({
      id: "s60",
      ciphertext: toBase64Url(new Uint8Array([60])),
      updatedAt: 60,
    });
    expect(firstPage.blobs[49]?.id).toBe("s11");

    const secondResponse = await getJson(
      `/v1/keys/${authId}/blobs?page=1&pageSize=50`,
    );
    const secondPage = (await secondResponse.json()) as {
      blobs: BlobRow[];
      nextPage?: number;
    };
    expect(secondPage.blobs).toHaveLength(10);
    expect(secondPage.nextPage).toBeUndefined();
    expect(secondPage.blobs[0]?.id).toBe("s10");
    expect(secondPage.blobs[9]?.id).toBe("s1");
  });

  it("clamps pageSize to 1..50 and defaults to page 0", async () => {
    const authId = "blob-clamp";
    for (let index = 0; index < 3; index += 1) {
      expect((await putSession(authId, `s${index}`)).status).toBe(
        index === 0 ? 201 : 200,
      );
    }

    const tooLarge = (await (
      await getJson(`/v1/keys/${authId}/blobs?page=0&pageSize=999`)
    ).json()) as { blobs: BlobRow[] };
    expect(tooLarge.blobs).toHaveLength(3);

    const tooSmall = (await (
      await getJson(`/v1/keys/${authId}/blobs?page=0&pageSize=0`)
    ).json()) as { blobs: BlobRow[]; nextPage?: number };
    expect(tooSmall.blobs).toHaveLength(1);
    expect(tooSmall.nextPage).toBe(1);

    const lastPage = (await (
      await getJson(`/v1/keys/${authId}/blobs?page=2&pageSize=1`)
    ).json()) as { blobs: BlobRow[]; nextPage?: number };
    expect(lastPage.blobs).toHaveLength(1);
    expect(lastPage.nextPage).toBeUndefined();
  });
});

describe("PUT last-write-wins", () => {
  it("rejects a stale write without changing the stored blob", async () => {
    const authId = "stale-write";
    const original = toBase64Url(new Uint8Array([1, 2, 3]));
    const competing = toBase64Url(new Uint8Array([9, 9, 9, 9, 9]));

    expect(
      (
        await putSession(authId, "s1", {
          ciphertext: original,
          updatedAt: 2_000,
        })
      ).status,
    ).toBe(201);

    const response = await putSession(authId, "s1", {
      ciphertext: competing,
      updatedAt: 1_000,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await readSession(authId, "s1")).toEqual({
      size: 3,
      updated_at: 2_000,
    });
  });

  it("accepts an equal timestamp so the client can repair its own copy", async () => {
    const authId = "equal-write";
    expect((await putSession(authId, "s1")).status).toBe(201);

    const response = await putSession(authId, "s1", {
      ciphertext: toBase64Url(new Uint8Array([4, 5, 6, 7])),
      updatedAt: 1_000,
    });

    expect(response.status).toBe(200);
    expect(await readSession(authId, "s1")).toEqual({
      size: 4,
      updated_at: 1_000,
    });
  });

  it("rejects writes at or before a tombstone and accepts a newer resurrection", async () => {
    const authId = "tombstone-write";
    await seedKey(authId);
    await env.DB.prepare(
      `INSERT INTO deletions (auth_id, session_id, deleted_at) VALUES (?, ?, ?)`,
    )
      .bind(authId, "s1", 5_000)
      .run();

    for (const updatedAt of [4_000, 5_000]) {
      const response = await putSession(authId, "s1", {
        ciphertext: SMALL_CIPHERTEXT,
        updatedAt,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(await readSession(authId, "s1")).toBeNull();
    }

    const resurrected = await putSession(authId, "s1", {
      ciphertext: SMALL_CIPHERTEXT,
      updatedAt: 6_000,
    });
    expect(resurrected.status).toBe(200);
    expect(await readSession(authId, "s1")).toEqual({
      size: 6,
      updated_at: 6_000,
    });
    // The tombstone is left for other devices; a later sync reconciles it.
    expect(await countRows("deletions", authId)).toBe(1);
  });

  it("does not change quota accounting for a rejected write", async () => {
    const authId = "stale-quota";
    await seedSessions(
      authId,
      Array.from({ length: LIMITS.maxSessionsPerKey }, (_, index) => ({
        id: `s${index}`,
        size: 1,
      })),
    );
    await env.DB.prepare(
      "DELETE FROM sessions WHERE auth_id = ? AND session_id = ?",
    )
      .bind(authId, "s0")
      .run();
    await env.DB.prepare(
      `INSERT INTO deletions (auth_id, session_id, deleted_at) VALUES (?, ?, ?)`,
    )
      .bind(authId, "s0", 5_000)
      .run();

    const rejected = await putSession(authId, "s0", {
      ciphertext: SMALL_CIPHERTEXT,
      updatedAt: 4_000,
    });

    expect(rejected.status).toBe(200);
    expect(await countRows("sessions", authId)).toBe(
      LIMITS.maxSessionsPerKey - 1,
    );
    expect(await readSession(authId, "s0")).toBeNull();

    const accepted = await putSession(authId, "s0", {
      ciphertext: SMALL_CIPHERTEXT,
      updatedAt: 6_000,
    });
    expect(accepted.status).toBe(200);
    expect(await countRows("sessions", authId)).toBe(LIMITS.maxSessionsPerKey);
  });
});

describe("PUT quotas", () => {
  it("rejects payloads over maxSessionBytes with 413", async () => {
    const authId = "oversized";
    const oversizedChars = Math.ceil(((LIMITS.maxSessionBytes + 1) * 4) / 3);

    const response = await putSession(authId, "huge", {
      ciphertext: "A".repeat(oversizedChars),
      updatedAt: 1,
    });

    expect(response.status).toBe(413);
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      "payload_too_large",
    );
    expect(await readKey(authId)).toBeNull();
    expect(await readSession(authId, "huge")).toBeNull();
  });

  it("rejects a new session beyond maxSessionsPerKey with 409", async () => {
    const authId = "session-quota";
    await seedSessions(
      authId,
      Array.from({ length: LIMITS.maxSessionsPerKey }, (_, index) => ({
        id: `s${index}`,
        size: 1,
      })),
    );

    const overflow = await putSession(authId, "overflow");
    expect(overflow.status).toBe(409);
    expect(((await overflow.json()) as ErrorBody).error.code).toBe(
      "quota_exceeded",
    );
    expect(await readSession(authId, "overflow")).toBeNull();

    const update = await putSession(authId, "s0");
    expect(update.status).toBe(200);
    expect(await countRows("sessions", authId)).toBe(LIMITS.maxSessionsPerKey);
  });

  it("rejects a new session beyond maxKeyBytes with 409 but allows same-id replacement", async () => {
    const authId = "byte-quota";
    await seedSessions(authId, [
      { id: "big", size: LIMITS.maxKeyBytes },
    ]);

    const overflow = await putSession(authId, "small");
    expect(overflow.status).toBe(409);
    expect(((await overflow.json()) as ErrorBody).error.code).toBe(
      "quota_exceeded",
    );

    const replacement = await putSession(authId, "big");
    expect(replacement.status).toBe(200);
    expect((await readSession(authId, "big"))?.size).toBe(6);
  });
});

describe("sync snapshot", () => {
  it("returns summaries, tombstones and the first blob page in one request", async () => {
    const authId = "snapshot";
    await seedSessions(authId, [
      { id: "older", size: 3, updatedAt: 1_000 },
      { id: "newer", size: 4, updatedAt: 2_000 },
    ]);
    await deleteSession(authId, "older");

    const response = await getJson(`/v1/keys/${authId}/sync`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      summaries: SessionSummary[];
      deletions: DeletionRow[];
      blobs: BlobRow[];
      nextPage?: number;
    };
    expect(body.summaries.map((row) => row.id)).toEqual(["newer"]);
    expect(body.blobs.map((row) => row.id)).toEqual(["newer"]);
    expect(body.deletions.map((row) => row.id)).toEqual(["older"]);
    expect(body.nextPage).toBeUndefined();
  });

  it("keeps the 50-blob page and reports nextPage for larger accounts", async () => {
    const authId = "snapshot-large";
    await seedSessions(
      authId,
      Array.from({ length: 51 }, (_, index) => ({
        id: `session-${String(index).padStart(2, "0")}`,
        size: 2,
        updatedAt: 1_000 + index,
      })),
    );

    const response = await getJson(`/v1/keys/${authId}/sync`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      summaries: SessionSummary[];
      deletions: DeletionRow[];
      blobs: BlobRow[];
      nextPage?: number;
    };
    expect(body.summaries).toHaveLength(51);
    expect(body.blobs).toHaveLength(50);
    expect(body.nextPage).toBe(1);
  });
});

describe("global capacity counters", () => {
  it("returns 429 capacity_exceeded when the daily key cap is reached", async () => {
    await seedCounter({ requests: 0, keysCreated: Number(env.GLOBAL_MAX_KEYS) });

    try {
      const response = await putSession("key-cap", "s1");
      expect(response.status).toBe(429);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "capacity_exceeded",
      );
      expect(await readKey("key-cap")).toBeNull();
    } finally {
      await resetCounters();
    }
  });
});

describe("CORS", () => {
  it("answers CORS preflight for WEB_ORIGIN", async () => {
    const response = await SELF.fetch(`${BASE_URL}/v1/keys/x/sessions`, {
      method: "OPTIONS",
      headers: {
        Origin: env.WEB_ORIGIN,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      env.WEB_ORIGIN,
    );
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Authorization, Content-Type",
    );
    expect(response.headers.get("access-control-max-age")).toBe("86400");
    expect(response.headers.get("vary")).toContain("Origin");
  });

  it("echoes extension origins and rejects other origins", async () => {
    const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const extension = await SELF.fetch(`${BASE_URL}/v1/health`, {
      method: "OPTIONS",
      headers: { Origin: extensionOrigin },
    });
    expect(extension.status).toBe(204);
    expect(extension.headers.get("access-control-allow-origin")).toBe(
      extensionOrigin,
    );

    const firefoxOrigin =
      "moz-extension://12345678-1234-1234-1234-123456789abc";
    const firefox = await SELF.fetch(`${BASE_URL}/v1/health`, {
      method: "OPTIONS",
      headers: { Origin: firefoxOrigin },
    });
    expect(firefox.status).toBe(204);
    expect(firefox.headers.get("access-control-allow-origin")).toBe(
      firefoxOrigin,
    );

    const safariOrigin =
      "safari-web-extension://12345678-1234-1234-1234-123456789abc";
    const safari = await SELF.fetch(`${BASE_URL}/v1/health`, {
      method: "OPTIONS",
      headers: { Origin: safariOrigin },
    });
    expect(safari.status).toBe(204);
    expect(safari.headers.get("access-control-allow-origin")).toBe(
      safariOrigin,
    );

    const website = await SELF.fetch(`${BASE_URL}/v1/health`, {
      headers: { Origin: env.WEB_ORIGIN },
    });
    expect(website.headers.get("access-control-allow-origin")).toBe(
      env.WEB_ORIGIN,
    );

    const foreign = await SELF.fetch(`${BASE_URL}/v1/health`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("rate limiting", () => {
  function fakeEnv(bindings: {
    ip?: Env["RATE_LIMITER_IP"];
    auth?: Env["RATE_LIMITER_AUTH"];
  }): Env {
    return {
      DB: env.DB,
      RELEASES: env.RELEASES,
      WEB_ORIGIN: env.WEB_ORIGIN,
      GLOBAL_MAX_KEYS: env.GLOBAL_MAX_KEYS,
      RATE_LIMITER_IP: bindings.ip,
      RATE_LIMITER_AUTH: bindings.auth,
    } as Env;
  }

  function sessionsUrl(authId: string): string {
    return `${BASE_URL}/v1/keys/${authId}/sessions`;
  }

  it("enforces independent per-IP and per-authId limits", async () => {
    const authId = "rate-independent";
    await seedKey(authId);

    const ipSeen: string[] = [];
    const authSeen: string[] = [];
    let ipCalls = 0;
    let authCalls = 0;
    const rateEnv = fakeEnv({
      ip: {
        limit: async ({ key }) => {
          ipSeen.push(key);
          ipCalls += 1;
          return { success: ipCalls <= 2 };
        },
      },
      auth: {
        limit: async ({ key }) => {
          authSeen.push(key);
          authCalls += 1;
          return { success: authCalls <= 3 };
        },
      },
    });
    const headers = bearerHeaders({ "CF-Connecting-IP": "198.51.100.9" });

    for (let index = 0; index < 2; index += 1) {
      expect(
        (await app.request(sessionsUrl(authId), { headers }, rateEnv)).status,
      ).toBe(200);
    }

    const blocked = await app.request(
      sessionsUrl(authId),
      { headers },
      rateEnv,
    );
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as ErrorBody).error.code).toBe(
      "rate_limited",
    );
    expect(ipSeen).toEqual([
      "ip:198.51.100.9",
      "ip:198.51.100.9",
      "ip:198.51.100.9",
    ]);
    // The IP bucket rejects before authentication, so the auth bucket is not
    // charged for the rejected request.
    expect(authSeen).toEqual([`auth:${authId}`, `auth:${authId}`]);
  });

  it("enforces the authId budget independently of a permissive IP budget", async () => {
    const authId = "rate-auth-tight";
    await seedKey(authId);

    let ipCalls = 0;
    let authCalls = 0;
    const rateEnv = fakeEnv({
      ip: {
        limit: async () => {
          ipCalls += 1;
          return { success: true };
        },
      },
      auth: {
        limit: async ({ key }) => {
          expect(key).toBe(`auth:${authId}`);
          authCalls += 1;
          return { success: authCalls <= 1 };
        },
      },
    });

    expect(
      (
        await app.request(
          sessionsUrl(authId),
          { headers: bearerHeaders() },
          rateEnv,
        )
      ).status,
    ).toBe(200);

    const blocked = await app.request(
      sessionsUrl(authId),
      { headers: bearerHeaders() },
      rateEnv,
    );
    expect(blocked.status).toBe(429);
    expect(ipCalls).toBe(2);
  });

  it("does not charge the authId bucket for an unverified bearer", async () => {
    const authId = "rate-bad-bearer";
    await seedKey(authId);

    const seen: string[] = [];
    const rateEnv = fakeEnv({
      auth: {
        limit: async ({ key }) => {
          seen.push(key);
          return { success: false };
        },
      },
    });

    const response = await app.request(
      sessionsUrl(authId),
      { headers: bearerHeaders({ Authorization: "Bearer not-the-key" }) },
      rateEnv,
    );

    expect(response.status).toBe(401);
    expect(seen).toEqual([]);
  });

  it("charges the authId bucket after the bearer verifies", async () => {
    const authId = "rate-valid-bearer";
    await seedKey(authId);

    const seen: string[] = [];
    const rateEnv = fakeEnv({
      auth: {
        limit: async ({ key }) => {
          seen.push(key);
          return { success: true };
        },
      },
    });

    const response = await app.request(
      sessionsUrl(authId),
      { headers: bearerHeaders() },
      rateEnv,
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual([`auth:${authId}`]);
  });

  it("applies only the configured bucket when the other binding is absent", async () => {
    const authId = "rate-one-binding";
    await seedKey(authId);

    const ipSeen: string[] = [];
    const ipOnly = await app.request(
      sessionsUrl(authId),
      { headers: bearerHeaders({ "CF-Connecting-IP": "203.0.113.11" }) },
      fakeEnv({
        ip: {
          limit: async ({ key }) => {
            ipSeen.push(key);
            return { success: true };
          },
        },
      }),
    );
    expect(ipOnly.status).toBe(200);
    expect(ipSeen).toEqual(["ip:203.0.113.11"]);

    const authOnly = await app.request(
      sessionsUrl(authId),
      { headers: bearerHeaders() },
      fakeEnv({
        auth: {
          limit: async () => ({ success: false }),
        },
      }),
    );
    expect(authOnly.status).toBe(429);
    expect(((await authOnly.json()) as ErrorBody).error.code).toBe(
      "rate_limited",
    );
  });

  it("is a no-op when both bindings are absent", async () => {
    const response = await app.request(
      `${BASE_URL}/v1/health`,
      {},
      fakeEnv({}),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("wraps unexpected failures in the error envelope", async () => {
    const brokenEnv = {
      ...fakeEnv({}),
      DB: {
        prepare() {
          throw new Error("database unavailable");
        },
      } as unknown as D1Database,
    } as Env;

    const response = await app.request(
      `${BASE_URL}/v1/keys/broken/sessions`,
      { headers: bearerHeaders() },
      brokenEnv,
    );

    expect(response.status).toBe(500);
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      "internal_error",
    );
  });
});
