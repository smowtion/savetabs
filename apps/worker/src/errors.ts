import type { Context } from "hono";
import type { Env } from "./env";

/**
 * Every worker error uses the same envelope so clients can branch on a stable
 * code instead of parsing messages.
 */
export type ErrorCode =
  | "unauthorized"
  | "not_found"
  | "quota_exceeded"
  | "payload_too_large"
  | "invalid_request"
  | "invalid_credentials"
  | "invalid_token"
  | "proof_required"
  | "vault_exists"
  | "auth_id_taken"
  | "rate_limited"
  | "capacity_exceeded"
  | "internal_error";

/** HTTP statuses that carry a JSON error body in this API. */
export type ErrorStatus =
  | 400
  | 401
  | 404
  | 409
  | 410
  | 413
  | 429
  | 500;

export type AppContext = Context<{ Bindings: Env }>;

/** Build the standard `{ error: { code, message } }` response. */
export function apiError(
  c: AppContext,
  status: ErrorStatus,
  code: ErrorCode,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}
