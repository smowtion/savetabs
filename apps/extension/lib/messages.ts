/**
 * Typed runtime messages between extension pages (popup, sessions, options)
 * and the background service worker.
 *
 * Every message receives a `UiResponse` instead of throwing across the
 * messaging boundary, so callers can render an actionable error. Messages whose
 * behavior lands in a later task are reported as `not_implemented` rather than
 * faking success.
 */

import type { SessionSource } from "@savetabs/shared";

import { executeRestore, type RestoreResult } from "./restore";
import { saveTabs, type SaveTabsResult } from "./save-flow";
import { deleteSession, getSession } from "./sessions-repo";

/** Every message an extension page may send to the background. */
export type UiMessage =
  | { type: "SAVE_TABS"; source: SessionSource }
  | { type: "RESTORE_SESSION"; sessionId: string }
  | { type: "DELETE_SESSION"; sessionId: string }
  | { type: "SYNC_NOW" }
  | { type: "DISCARD_NOW" };

/** Failure reasons a caller can branch on. */
export type UiErrorCode =
  | "invalid_message"
  | "not_found"
  | "not_implemented"
  | "error";

/**
 * Uniform response shape.
 *
 * `data` mirrors the underlying flow result; `error` responses carry a
 * human-readable `message` when one is available (for example a quota error).
 */
export type UiResponse =
  | { ok: true; data: SaveTabsResult | RestoreResult | { deleted: string } }
  | { ok: false; code: UiErrorCode; message?: string };

const SESSION_SOURCES: ReadonlySet<string> = new Set([
  "window",
  "all-windows",
  "tab",
  "selection",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionSource(value: unknown): value is SessionSource {
  return typeof value === "string" && SESSION_SOURCES.has(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function invalidMessage(): UiResponse {
  return { ok: false, code: "invalid_message" };
}

function notImplemented(): UiResponse {
  return { ok: false, code: "not_implemented" };
}

function failed(error: unknown): UiResponse {
  return {
    ok: false,
    code: "error",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Validate and dispatch one runtime message.
 *
 * Malformed payloads for a known type are rejected without side effects.
 * Unknown types return `not_implemented` because they may be added by a newer
 * extension page talking to an older service worker.
 */
export async function handleUiMessage(message: unknown): Promise<UiResponse> {
  if (!isRecord(message) || typeof message.type !== "string") {
    return invalidMessage();
  }

  switch (message.type) {
    case "SAVE_TABS": {
      if (!isSessionSource(message.source)) return invalidMessage();
      try {
        return { ok: true, data: await saveTabs(message.source) };
      } catch (error) {
        return failed(error);
      }
    }

    case "RESTORE_SESSION": {
      if (!isNonEmptyString(message.sessionId)) return invalidMessage();
      try {
        const session = await getSession(message.sessionId);
        if (session === undefined) return { ok: false, code: "not_found" };
        return { ok: true, data: await executeRestore(session) };
      } catch (error) {
        return failed(error);
      }
    }

    case "DELETE_SESSION": {
      if (!isNonEmptyString(message.sessionId)) return invalidMessage();
      try {
        await deleteSession(message.sessionId);
        return { ok: true, data: { deleted: message.sessionId } };
      } catch (error) {
        return failed(error);
      }
    }

    // Handlers are added with the auto-discard service and the sync service.
    case "SYNC_NOW":
    case "DISCARD_NOW":
      return notImplemented();

    default:
      return notImplemented();
  }
}
