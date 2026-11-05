/**
 * Per-account daily outbound email budget.
 *
 * `RATE_LIMITER_EMAIL` smooths bursts (5 per minute), but an account could
 * still drip requests and exhaust the Resend quota over a day. Every send
 * tied to an account claims one slot here first; the UTC day is the bucket,
 * so the budget refills at midnight UTC.
 */

import { currentDay } from "../counters";

/** Maximum Resend sends one account may cause per UTC day (spec: 5). */
export const DAILY_EMAIL_LIMIT = 5;

/**
 * Claim one send from `accountId`'s budget for the current UTC day.
 *
 * A single conditional upsert makes the claim atomic: concurrent requests
 * cannot both take the last slot, and a refused claim leaves `count` at the
 * cap instead of growing it without bound. Returns false when the budget is
 * already spent; callers skip the send but keep their generic response.
 *
 * D1 failures fail open: an accounting table must not take account flows
 * down, and the rate-limit binding still guards bursts.
 */
export async function consumeEmailSend(
  db: D1Database,
  accountId: string,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO email_sends (account_id, day, count) VALUES (?, ?, 1)
         ON CONFLICT (account_id, day) DO UPDATE SET count = count + 1
           WHERE email_sends.count < ?
         RETURNING count`,
      )
      .bind(accountId, currentDay(now), DAILY_EMAIL_LIMIT)
      .first<{ count: number }>();
    return row !== null;
  } catch {
    return true;
  }
}
