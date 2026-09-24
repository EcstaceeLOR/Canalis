CREATE TABLE IF NOT EXISTS wallet_auth_challenges (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  domain TEXT NOT NULL,
  network TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at_unix BIGINT NOT NULL,
  expires_at_unix BIGINT NOT NULL,
  used_at_unix BIGINT
);

CREATE TABLE IF NOT EXISTS wallet_sessions (
  token_hash TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  network TEXT NOT NULL,
  created_at_unix BIGINT NOT NULL,
  expires_at_unix BIGINT NOT NULL,
  last_seen_at_unix BIGINT NOT NULL,
  revoked_at_unix BIGINT
);

CREATE INDEX IF NOT EXISTS idx_wallet_challenges_wallet
  ON wallet_auth_challenges(wallet_address, created_at_unix DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_challenges_expiry
  ON wallet_auth_challenges(expires_at_unix);
CREATE INDEX IF NOT EXISTS idx_wallet_sessions_wallet
  ON wallet_sessions(wallet_address, created_at_unix DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_sessions_expiry
  ON wallet_sessions(expires_at_unix);
