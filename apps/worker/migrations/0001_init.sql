-- SaveTabs sync schema (spec §5.3).
-- The server stores only opaque identifiers, SHA-256 hashes and encrypted
-- blobs; URL/title plaintext never leaves the client.

CREATE TABLE keys (
  auth_id       TEXT PRIMARY KEY,
  key_hash      TEXT NOT NULL,      -- SHA-256 hex of the bearer authKey
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE TABLE sessions (
  auth_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  ciphertext  BLOB NOT NULL,        -- base64url-decoded IV || AES-GCM ciphertext
  updated_at  INTEGER NOT NULL,
  size        INTEGER NOT NULL,     -- ciphertext byte length
  PRIMARY KEY (auth_id, session_id)
);

CREATE INDEX idx_sessions_auth_updated
  ON sessions (auth_id, updated_at DESC);

-- Tombstones so another device does not resurrect a deleted session.
CREATE TABLE deletions (
  auth_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  deleted_at  INTEGER NOT NULL,
  PRIMARY KEY (auth_id, session_id)
);

-- Global daily caps for abuse protection.
CREATE TABLE counters (
  day           TEXT PRIMARY KEY,
  requests      INTEGER NOT NULL DEFAULT 0,
  keys_created  INTEGER NOT NULL DEFAULT 0
);
