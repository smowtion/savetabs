/**
 * Typed runtime messages between extension pages (popup, sessions, options)
 * and the background service worker.
 *
 * Every message receives a `UiResponse` instead of throwing across the
 * messaging boundary, so callers can render an actionable error. Messages whose
 * behavior lands in a later task are reported as `not_implemented` rather than
 * faking success.
 */

import { SyncAuthError, type SessionSource } from "@savetabs/shared";

import { discardNow, type DiscardResult } from "./discard";
import { executeRestore, type RestoreResult } from "./restore";
import { saveTabs, type SaveTabsResult } from "./save-flow";
import { deleteSession, getSession } from "./sessions-repo";
import { syncSavedSession } from "./sync/sync-lifecycle";
import { syncNow, type SyncResult } from "./sync/sync-service";

/** Every message an extension page may send to the background. */
export type UiMessage =
  | {
      type: "SAVE_TABS";
      source: SessionSource;
      /**
       * Set after the user approved closing more tabs than
       * `general.confirmThreshold`. The first request omits it and may be
       * answered with `confirmation_required`.
       */
      confirmed?: boolean;
    }
  | { type: "RESTORE_SESSION"; sessionId: string }
  | { type: "DELETE_SESSION"; sessionId: string }
  | { type: "SYNC_NOW" }
  | { type: "DISCARD_NOW" };

/** Failure reasons a caller can branch on. */
export type UiErrorCode =
  | "invalid_message"
  | "not_found"
  | "not_implemented"
  | "error"
  | "unauthorized"
  | "confirmation_required";

/**
 * Uniform response shape.
 *
 * `data` mirrors the underlying flow result; error responses carry a
 * human-readable `message` when one is available (for example a quota error).
 * `confirmation_required` is the two-phase save response: nothing was saved
 * or closed, and `data.count` is the number of tabs the save would close.
 */
export type UiResponse =
  | {
      ok: true;
      data:
        | SaveTabsResult
        | RestoreResult
        | DiscardResult
        | SyncResult
        | { deleted: string };
    }
  | {
      ok: false;
      code: UiErrorCode;
      message?: string;
      data?: { count: number };
    };

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
      if (
        message.confirmed !== undefined &&
        typeof message.confirmed !== "boolean"
      ) {
        return invalidMessage();
      }
      const confirmed = message.confirmed === true;

      // The first request asks for approval instead of saving. Nothing is
      // persisted or closed when the hook declines; the page retries with
      // `confirmed: true` after the user accepts the dialog.
      let requiredCount: number | undefined;
      try {
        const result = await saveTabs(message.source, {
          confirm: (count) => {
            if (confirmed) return true;
            requiredCount = count;
            return false;
          },
          // Only this newly persisted session reaches the sync service; the
          // hook checks `sync.enabled`/`sync.autoUpload` and contains failures.
          onSaved: syncSavedSession,
        });
        if (requiredCount !== undefined) {
          return {
            ok: false,
            code: "confirmation_required",
            data: { count: requiredCount },
          };
        }
        return { ok: true, data: result };
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

    case "DISCARD_NOW": {
      try {
        return { ok: true, data: await discardNow() };
      } catch (error) {
        return failed(error);
      }
    }

    case "SYNC_NOW": {
      try {
        return { ok: true, data: await syncNow() };
      } catch (error) {
        if (error instanceof SyncAuthError) {
          // A rejected key is an auth problem, not a generic failure: the UI
          // can point the user at re-importing or rotating the key.
          return { ok: false, code: "unauthorized", message: error.message };
        }
        return failed(error);
      }
    }

    default:
      return notImplemented();
  }
}
