-- Per-account daily outbound email budget (spec "Accounts": 5 sends/day).
-- The rate-limit binding covers short bursts; this table bounds the daily
-- total so one mailbox cannot be slowly flooded or drain the Resend quota.

CREATE TABLE email_sends (
  account_id TEXT NOT NULL,
  day        TEXT NOT NULL,   -- UTC YYYY-MM-DD
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day)
);
