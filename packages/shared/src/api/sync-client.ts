/**
 * HTTP client for the SaveTabs sync API.
 *
 * The client is deliberately dumb: it authenticates with the derived bearer
 * key, maps the documented endpoints to typed method calls and turns every
 * non-2xx response into a typed error. It never touches plaintext sessions or
 * crypto keys; callers encrypt before `put` and decrypt after `get`/`listBlobs`.
 *
 * A 401 means the key does not match the account and is always surfaced as
 * `SyncAuthError`, so UIs can show an auth problem instead of an empty state.
 *
 * Runs in the extension, the web app and anywhere `fetch` exists.
 */

import type { ApiErrorCode, SessionSummary } from "../types";

/** One encrypted session as returned by the bulk endpoint or `get`. */
export type RemoteSessionBlob = {
  id: string;
  /** base64url(IV || AES-GCM ciphertext). */
  ciphertext: string;
  /** epoch ms */
  updatedAt: number;
};

/** One tombstone as returned by the deletions endpoint. */
export type RemoteDeletion = {
  id: string;
  /** epoch ms */
  deletedAt: number;
};

/** One page of the bulk blob endpoint. `nextPage` is absent on the last page. */
export type BlobPage = {
  blobs: RemoteSessionBlob[];
  nextPage?: number;
};

/**
 * Everything a full sync reads, returned by one `GET /sync` request.
 * `nextPage` refers to the existing paged `/blobs` endpoint.
 */
export type SyncSnapshot = {
  summaries: SessionSummary[];
  deletions: RemoteDeletion[];
  blobs: RemoteSessionBlob[];
  nextPage?: number;
};

/** Codes carried by sync API error envelopes, plus the worker catch-all. */
export type SyncErrorCode = ApiErrorCode | "internal_error";

/** A non-2xx sync API response with the server's stable error code. */
export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: SyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SyncHttpError";
  }
}

/** Thrown for HTTP 401: the bearer key is missing, wrong, or revoked. */
export class SyncAuthError extends SyncHttpError {
  constructor(message = "The sync server rejected the sync key.") {
    super(401, "unauthorized", message);
    this.name = "SyncAuthError";
  }
}

type ErrorEnvelope = {
  error?: { code?: unknown; message?: unknown };
};

type SummariesBody = { sessions?: SessionSummary[] };
type DeletionsBody = { deletions?: RemoteDeletion[] };

export class SyncClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly authId: string,
    private readonly authKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    // Deployments frequently pass an origin with a trailing slash; normalize
    // once so every path below is built the same way.
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /** Session metadata (id, updatedAt, encrypted size) for the whole key. */
  async listSummaries(): Promise<SessionSummary[]> {
    const body = await this.request<SummariesBody>("/sessions");
    return body.sessions ?? [];
  }

  /**
   * Read summaries, tombstones and the first blob page in one request.
   * Large accounts follow `nextPage` through the paged `/blobs` endpoint.
   */
  async snapshot(): Promise<SyncSnapshot> {
    const body = await this.request<Partial<SyncSnapshot>>("/sync");
    return {
      summaries: body.summaries ?? [],
      deletions: body.deletions ?? [],
      blobs: body.blobs ?? [],
      ...(typeof body.nextPage === "number"
        ? { nextPage: body.nextPage }
        : {}),
    };
  }

  /** Download one encrypted session. Throws `SyncHttpError` when absent. */
  get(id: string): Promise<RemoteSessionBlob> {
    return this.request<RemoteSessionBlob>(`/sessions/${encodeURIComponent(id)}`);
  }

  /** Upload one encrypted session. The first PUT also registers the key. */
  async put(id: string, ciphertext: string, updatedAt: number): Promise<void> {
    await this.request<unknown>(`/sessions/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ ciphertext, updatedAt }),
    });
  }

  /** Delete one session; the server records a tombstone. Idempotent. */
  async delete(id: string): Promise<void> {
    await this.request<unknown>(`/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  /** Download one page of encrypted sessions, newest first. */
  async listBlobs(page = 0, pageSize = 50): Promise<BlobPage> {
    const body = await this.request<BlobPage>(
      `/blobs?page=${page}&pageSize=${pageSize}`,
    );
    const blobs = body.blobs ?? [];
    return typeof body.nextPage === "number"
      ? { blobs, nextPage: body.nextPage }
      : { blobs };
  }

  /** All tombstones the server still remembers (30-day retention). */
  async listDeletions(): Promise<RemoteDeletion[]> {
    const body = await this.request<DeletionsBody>("/deletions");
    return body.deletions ?? [];
  }

  /** Delete every session, tombstone and the key row for this authId. */
  async deleteAll(): Promise<void> {
    await this.request<unknown>("", { method: "DELETE" });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.authKey}`);
    if (init.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    const url = `${this.baseUrl}/v1/keys/${encodeURIComponent(this.authId)}${path}`;
    // Native fetch is a Window/Worker method and rejects other receivers with
    // "Illegal invocation"; calling it as `this.fetchImpl(...)` would pass the
    // client instance. Pin the receiver to the global scope instead.
    const response = await this.fetchImpl.call(globalThis, url, {
      ...init,
      headers,
    });

    if (!response.ok) throw await this.toError(response);
    if (response.status === 204) return undefined as T;

    const text = await response.text();
    if (text.length === 0) return undefined as T;
    return JSON.parse(text) as T;
  }

  /** Build a typed error, using the API envelope when the body is valid JSON. */
  private async toError(response: Response): Promise<SyncHttpError> {
    let code: SyncErrorCode = "internal_error";
    let message = `Sync request failed with HTTP ${response.status}`;

    try {
      const body = (await response.json()) as ErrorEnvelope;
      if (typeof body.error?.code === "string") {
        code = body.error.code as SyncErrorCode;
      }
      if (
        typeof body.error?.message === "string" &&
        body.error.message.length > 0
      ) {
        message = body.error.message;
      }
    } catch {
      // Non-JSON error bodies keep the fallback code and message.
    }

    return response.status === 401
      ? new SyncAuthError(message)
      : new SyncHttpError(response.status, code, message);
  }
}
