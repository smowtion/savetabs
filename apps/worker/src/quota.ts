import { LIMITS } from "@savetabs/shared/constants";
import type { ErrorCode, ErrorStatus } from "./errors";

/** A quota rule rejected the upload; `null` means the payload fits. */
export interface QuotaRejection {
  status: Extract<ErrorStatus, 409 | 413>;
  code: Extract<ErrorCode, "payload_too_large" | "quota_exceeded">;
  message: string;
}

/** Reject a single blob larger than the shared per-session limit. */
export function checkPayloadSize(byteLength: number): QuotaRejection | null {
  if (byteLength > LIMITS.maxSessionBytes) {
    return {
      status: 413,
      code: "payload_too_large",
      message: `A session blob must not exceed ${LIMITS.maxSessionBytes} bytes.`,
    };
  }
  return null;
}

/**
 * Check the per-key session-count and total-byte budgets.
 *
 * The stored size of an existing session with the same id is subtracted before
 * comparing, so updating a session in place never double-counts its bytes and
 * does not run into the session-count cap.
 */
export async function checkSessionQuota(
  db: D1Database,
  authId: string,
  sessionId: string,
  newSize: number,
): Promise<QuotaRejection | null> {
  const usage = await db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes
         FROM sessions
        WHERE auth_id = ?`,
    )
    .bind(authId)
    .first<{ count: number; bytes: number }>();

  const existing = await db
    .prepare(
      "SELECT size FROM sessions WHERE auth_id = ? AND session_id = ?",
    )
    .bind(authId, sessionId)
    .first<{ size: number }>();

  const sessionCount = usage?.count ?? 0;
  const storedBytes = usage?.bytes ?? 0;
  const replacedBytes = existing?.size ?? 0;

  if (existing === null && sessionCount >= LIMITS.maxSessionsPerKey) {
    return {
      status: 409,
      code: "quota_exceeded",
      message: `A sync key can hold at most ${LIMITS.maxSessionsPerKey} sessions.`,
    };
  }

  const projectedBytes = storedBytes - replacedBytes + newSize;
  if (projectedBytes > LIMITS.maxKeyBytes) {
    return {
      status: 409,
      code: "quota_exceeded",
      message: `A sync key can hold at most ${LIMITS.maxKeyBytes} bytes.`,
    };
  }

  return null;
}
