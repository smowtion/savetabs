import { describe, expect, it, vi } from "vitest";

import { SyncAuthError, SyncClient, SyncHttpError } from "./sync-client";

const ORIGIN = "https://api.savetabs.test";
const AUTH_ID = "auth-id";
const AUTH_KEY = "auth-key-secret";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

/** Client pointed at a deliberately trailing-slash base URL. */
function createClient(fetchImpl: typeof fetch): SyncClient {
  return new SyncClient(`${ORIGIN}///`, AUTH_ID, AUTH_KEY, fetchImpl);
}

function requestInit(mock: ReturnType<typeof vi.fn<typeof fetch>>, call: number): RequestInit {
  return mock.mock.calls[call]?.[1] ?? {};
}

describe("SyncClient", () => {
  it("normalizes the base URL and sends the bearer token", async () => {
    const sessions = [{ id: "session-1", updatedAt: 7, size: 42 }];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ sessions }),
    );

    const client = createClient(fetchMock);

    await expect(client.listSummaries()).resolves.toEqual(sessions);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${ORIGIN}/v1/keys/${AUTH_ID}/sessions`,
    );
    expect(new Headers(requestInit(fetchMock, 0).headers).get("authorization")).toBe(
      `Bearer ${AUTH_KEY}`,
    );
  });

  it("reads one encrypted session by id", async () => {
    const blob = { id: "session-1", ciphertext: "AAAA", updatedAt: 9 };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(blob));
    const client = createClient(fetchMock);

    await expect(client.get("session-1")).resolves.toEqual(blob);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${ORIGIN}/v1/keys/${AUTH_ID}/sessions/session-1`,
    );
    expect(requestInit(fetchMock, 0).method).toBeUndefined();
  });

  it("uploads ciphertext as JSON with PUT", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ok: true }));
    const client = createClient(fetchMock);

    await expect(
      client.put("session-1", "ciphertext-value", 123),
    ).resolves.toBeUndefined();

    const init = requestInit(fetchMock, 0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${ORIGIN}/v1/keys/${AUTH_ID}/sessions/session-1`,
    );
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(init.body).toBe(
      JSON.stringify({ ciphertext: "ciphertext-value", updatedAt: 123 }),
    );
  });

  it("deletes one session and accepts an empty 204 response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(emptyResponse(204));
    const client = createClient(fetchMock);

    await expect(client.delete("session-1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${ORIGIN}/v1/keys/${AUTH_ID}/sessions/session-1`,
    );
    expect(requestInit(fetchMock, 0).method).toBe("DELETE");
  });

  it("pages blobs with the requested page and page size", async () => {
    const blob = { id: "session-1", ciphertext: "AAAA", updatedAt: 9 };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ blobs: [blob], nextPage: 3 }));
    const client = createClient(fetchMock);

    await expect(client.listBlobs(2, 25)).resolves.toEqual({
      blobs: [blob],
      nextPage: 3,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${ORIGIN}/v1/keys/${AUTH_ID}/blobs?page=2&pageSize=25`,
    );
  });

  it("defaults blobs to the first page of 50 and omits an absent nextPage", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ blobs: [] }));
    const client = createClient(fetchMock);

    await expect(client.listBlobs()).resolves.toEqual({ blobs: [] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${ORIGIN}/v1/keys/${AUTH_ID}/blobs?page=0&pageSize=50`,
    );
  });

  it("lists deletions", async () => {
    const deletions = [{ id: "session-1", deletedAt: 11 }];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ deletions }));
    const client = createClient(fetchMock);

    await expect(client.listDeletions()).resolves.toEqual(deletions);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${ORIGIN}/v1/keys/${AUTH_ID}/deletions`,
    );
  });

  it("deletes all server data for the key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(emptyResponse(204));
    const client = createClient(fetchMock);

    await expect(client.deleteAll()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${ORIGIN}/v1/keys/${AUTH_ID}`,
    );
    expect(requestInit(fetchMock, 0).method).toBe("DELETE");
  });

  it("throws SyncAuthError on HTTP 401", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { error: { code: "unauthorized", message: "A valid bearer token is required." } },
        401,
      ),
    );
    const client = createClient(fetchMock);

    const error = await client.listSummaries().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SyncAuthError);
    expect(error).toMatchObject({
      status: 401,
      code: "unauthorized",
      message: "A valid bearer token is required.",
    });
  });

  it("throws a typed SyncHttpError for other error statuses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { error: { code: "quota_exceeded", message: "Session quota reached." } },
        409,
      ),
    );
    const client = createClient(fetchMock);

    const error = await client.put("session-1", "AAAA", 1).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(SyncHttpError);
    expect(error).not.toBeInstanceOf(SyncAuthError);
    expect(error).toMatchObject({
      status: 409,
      code: "quota_exceeded",
      message: "Session quota reached.",
    });
  });

  it("falls back to internal_error when the error body is not JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("boom", { status: 500 }),
    );
    const client = createClient(fetchMock);

    const error = await client.listDeletions().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SyncHttpError);
    expect(error).toMatchObject({ status: 500, code: "internal_error" });
    expect((error as Error).message).toContain("500");
  });
});
