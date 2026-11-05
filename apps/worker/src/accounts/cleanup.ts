/**
 * Retention for accounts that were never completed.
 *
 * Signup creates the account row before the email is verified, so an
 * abandoned signup would otherwise live forever. An account is only swept
 * when it never verified its address and never linked a vault, and even then
 * only after 30 days. Tokens, verification links and send counters are
 * removed explicitly because the schema has no foreign keys.
 */

/** Abandoned signups older than this are deleted. */
export const UNVERIFIED_ACCOUNT_TTL_DAYS = 30;
const UNVERIFIED_ACCOUNT_TTL_MS =
  UNVERIFIED_ACCOUNT_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Accounts matching the sweep predicate, as a subquery for child deletes. */
const EXPIRED_ACCOUNT_IDS = `SELECT id FROM accounts
  WHERE email_verified_at IS NULL AND auth_id IS NULL AND created_at < ?`;

/**
 * Delete unverified, unlinked accounts created before `now - 30 days`, plus
 * their `account_tokens`, `email_verifications` and `email_sends` rows.
 *
 * The statements run in one batch, so the child rows and the account they
 * belong to disappear together. Returns the number of accounts deleted.
 */
export async function cleanupUnverifiedAccounts(
  db: D1Database,
  now: number = Date.now(),
): Promise<number> {
  const cutoff = now - UNVERIFIED_ACCOUNT_TTL_MS;

  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM account_tokens WHERE account_id IN (${EXPIRED_ACCOUNT_IDS})`,
      )
      .bind(cutoff),
    db
      .prepare(
        `DELETE FROM email_verifications WHERE account_id IN (${EXPIRED_ACCOUNT_IDS})`,
      )
      .bind(cutoff),
    db
      .prepare(
        `DELETE FROM email_sends WHERE account_id IN (${EXPIRED_ACCOUNT_IDS})`,
      )
      .bind(cutoff),
    db
      .prepare(
        `DELETE FROM accounts
          WHERE email_verified_at IS NULL AND auth_id IS NULL
            AND created_at < ?`,
      )
      .bind(cutoff),
  ]);

  return results.at(-1)?.meta.changes ?? 0;
}
