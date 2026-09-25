CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  owner_wallet TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  source_version TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('task', 'provider', 'channel', 'settlement', 'recovery', 'integration')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'success', 'warning', 'critical')),
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  guidance TEXT,
  error_code TEXT,
  task_id TEXT,
  provider_id TEXT,
  channel_address TEXT,
  transaction_signature TEXT,
  action_kind TEXT NOT NULL DEFAULT 'none',
  action_label TEXT,
  action_href TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  read_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (owner_wallet, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_activity_owner_last_seen
  ON activity_events(owner_wallet, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_owner_unread
  ON activity_events(owner_wallet, state, severity, last_seen_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_activity_task
  ON activity_events(owner_wallet, task_id, last_seen_at DESC)
  WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_provider
  ON activity_events(owner_wallet, provider_id, last_seen_at DESC)
  WHERE provider_id IS NOT NULL;
