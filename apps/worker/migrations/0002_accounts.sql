-- SaveTabs accounts schema (spec "Data model").
-- Accounts hold an email, the password-derived auth proof and the wrapped
-- sync key; tokens and email verifications expire and are revoked server-side.

CREATE TABLE accounts (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE,      -- lowercased, trimmed
  auth_hash        TEXT NOT NULL,             -- hex SHA-256 of the client proof
  kdf_salt         TEXT NOT NULL,             -- base64url, 16 bytes
  kdf_iterations   INTEGER NOT NULL,
  wrapped_key      TEXT,                      -- base64url(IV || ciphertext)
  auth_id          TEXT UNIQUE,               -- linked sync key, null until set
  locale           TEXT NOT NULL DEFAULT 'en', -- verification/reset email language
  email_verified_at INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE account_tokens (
  token_hash    TEXT PRIMARY KEY,             -- hex SHA-256 of the bearer token
  account_id    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_used_at  INTEGER NOT NULL
);

CREATE TABLE email_verifications (
  token_hash  TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  purpose     TEXT NOT NULL                   -- 'verify' | 'reset'
);

CREATE INDEX idx_account_tokens_account ON account_tokens (account_id);
CREATE INDEX idx_email_verifications_account ON email_verifications (account_id);
