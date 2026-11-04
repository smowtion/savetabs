import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256Hex, timingSafeEqual } from "../src/auth";

const BASE_URL = "https://savetabs.test";
const AUTH_KEY = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA";
const SESSION_BODY = { ciphertext: "AQIDBAUG", updatedAt: 1_700_000_000_000 };

interface KeyRow {
  auth_id: string;
  key_hash: string;
  created_at: number;
  last_seen_at: number;
}

interface SessionRow {
  auth_id: string;
  session_id: string;
  ciphertext: ArrayBuffer;
  updated_at: number;
  size: number;
}

interface ErrorBody {
  error: { code: string; message: string };
}

function bearerHeaders(authKey: string): Record<string, string> {
  return { Authorization: `Bearer ${authKey}`, "content-type": "application/json" };
}

function putSession(options: {
  authId: string;
  sessionId?: string;
  authKey?: string | null;
  body?: unknown;
  rawBody?: string;
}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.authKey !== null) {
    headers.Authorization = `Bearer ${options.authKey ?? AUTH_KEY}`;
  }
  return SELF.fetch(
    `${BASE_URL}/v1/keys/${options.authId}/sessions/${options.sessionId ?? "session-1"}`,
    {
      method: "PUT",
      headers,
      body: options.rawBody ?? JSON.stringify(options.body ?? SESSION_BODY),
    },
  );
}

function readKey(authId: string): Promise<KeyRow | null> {
  return env.DB.prepare("SELECT * FROM keys WHERE auth_id = ?")
    .bind(authId)
    .first<KeyRow>();
}

function readSession(
  authId: string,
  sessionId: string,
): Promise<SessionRow | null> {
  return env.DB.prepare(
    "SELECT * FROM sessions WHERE auth_id = ? AND session_id = ?",
  )
    .bind(authId, sessionId)
    .first<SessionRow>();
}

describe("auth helpers", () => {
  it("hashes the bearer string to lowercase SHA-256 hex", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("compares strings without leaking length or content through early exit", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("GET /v1/health", () => {
  it("answers with ok without authentication", async () => {
    const response = await SELF.fetch(`${BASE_URL}/v1/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("PUT /v1/keys/:authId/sessions/:sessionId", () => {
  it("auto-registers the key and stores the session on the first PUT", async () => {
    const authId = "first-put";
    const response = await putSession({ authId, sessionId: "session-1" });

    expect(response.status).toBe(201);

    const key = await readKey(authId);
    expect(key).not.toBeNull();
    expect(key?.key_hash).toBe(await sha256Hex(AUTH_KEY));
    expect(key?.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(key?.created_at).toBeGreaterThan(0);
    expect(key?.last_seen_at).toBe(key?.created_at);

    const session = await readSession(authId, "session-1");
    expect(session).not.toBeNull();
    expect(new Uint8Array(session?.ciphertext ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6]),
    );
    expect(session?.updated_at).toBe(SESSION_BODY.updatedAt);
    expect(session?.size).toBe(6);
  });

  it("updates last_seen_at and upserts the session when the bearer matches", async () => {
    const authId = "second-put";
    expect((await putSession({ authId, sessionId: "s1" })).status).toBe(201);
    const firstKey = await readKey(authId);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const response = await putSession({
      authId,
      sessionId: "s1",
      body: { ciphertext: "BwgJCgsM", updatedAt: SESSION_BODY.updatedAt + 1_000 },
    });

    expect(response.status).toBe(200);
    const key = await readKey(authId);
    expect(key?.created_at).toBe(firstKey?.created_at);
    expect(key?.last_seen_at).toBeGreaterThan(firstKey?.last_seen_at ?? 0);

    const session = await readSession(authId, "s1");
    expect(session?.updated_at).toBe(SESSION_BODY.updatedAt + 1_000);
    expect(session?.size).toBe(6);
    expect(new Uint8Array(session?.ciphertext ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([7, 8, 9, 10, 11, 12]),
    );

    const keyCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM keys WHERE auth_id = ?",
    )
      .bind(authId)
      .first<{ count: number }>();
    expect(keyCount?.count).toBe(1);
  });

  it("rejects a wrong bearer without touching the stored session", async () => {
    const authId = "wrong-bearer";
    expect((await putSession({ authId, sessionId: "s1" })).status).toBe(201);

    const response = await putSession({
      authId,
      sessionId: "s1",
      authKey: "definitely-not-the-key",
      body: { ciphertext: "BwgJ", updatedAt: 99 },
    });

    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      "unauthorized",
    );

    const session = await readSession(authId, "s1");
    expect(session?.updated_at).toBe(SESSION_BODY.updatedAt);
    expect(session?.size).toBe(6);
  });

  it("checks the bearer before validating the body", async () => {
    const authId = "auth-before-body";
    expect((await putSession({ authId })).status).toBe(201);

    const response = await putSession({
      authId,
      authKey: "wrong",
      rawBody: "not json",
    });

    expect(response.status).toBe(401);
  });

  it("rejects a missing Authorization header", async () => {
    const response = await putSession({ authId: "missing-auth", authKey: null });

    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error.code).toBe(
      "unauthorized",
    );
  });

  it("rejects malformed Authorization headers", async () => {
    for (const authorization of ["", "Basic ABC", "Bearer", "Bearer   "]) {
      const response = await SELF.fetch(
        `${BASE_URL}/v1/keys/malformed-auth/sessions/s1`,
        {
          method: "PUT",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify(SESSION_BODY),
        },
      );

      expect(response.status).toBe(401);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "unauthorized",
      );
    }
  });

  it("rejects invalid bodies with invalid_request", async () => {
    const cases: Array<{ rawBody: string }> = [
      { rawBody: "not json" },
      { rawBody: JSON.stringify({ updatedAt: 1 }) },
      { rawBody: JSON.stringify({ ciphertext: "", updatedAt: 1 }) },
      { rawBody: JSON.stringify({ ciphertext: "AQID" }) },
      { rawBody: JSON.stringify({ ciphertext: "AQID", updatedAt: "1" }) },
      { rawBody: JSON.stringify({ ciphertext: "AQID", updatedAt: null }) },
      { rawBody: JSON.stringify({ ciphertext: "not base64!", updatedAt: 1 }) },
    ];

    for (const [index, testCase] of cases.entries()) {
      const response = await putSession({
        authId: `invalid-body-${index}`,
        rawBody: testCase.rawBody,
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).error.code).toBe(
        "invalid_request",
      );
    }

    expect(await readKey("invalid-body-0")).toBeNull();
    expect(await readKey("invalid-body-6")).toBeNull();
  });
});

describe("GET /v1/keys/:authId/sessions", () => {
  it("returns not_found when the key has never been registered", async () => {
    const response = await SELF.fetch(
      `${BASE_URL}/v1/keys/never-registered/sessions`,
      { headers: bearerHeaders(AUTH_KEY) },
    );

    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).error.code).toBe("not_found");
  });

  it("rejects a wrong bearer for a registered key", async () => {
    const authId = "get-wrong-bearer";
    expect((await putSession({ authId })).status).toBe(201);

    const response = await SELF.fetch(
      `${BASE_URL}/v1/keys/${authId}/sessions`,
      { headers: bearerHeaders("wrong") },
    );

    expect(response.status).toBe(401);
  });

  it("lists stored sessions in most-recently-updated order", async () => {
    const authId = "get-list";
    expect(
      (
        await putSession({
          authId,
          sessionId: "older",
          body: { ciphertext: "AQID", updatedAt: 1_000 },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await putSession({
          authId,
          sessionId: "newer",
          body: { ciphertext: "BAUG", updatedAt: 2_000 },
        })
      ).status,
    ).toBe(200);

    const response = await SELF.fetch(
      `${BASE_URL}/v1/keys/${authId}/sessions`,
      { headers: bearerHeaders(AUTH_KEY) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sessions: [
        { id: "newer", updatedAt: 2_000, size: 3 },
        { id: "older", updatedAt: 1_000, size: 3 },
      ],
    });
  });
});
