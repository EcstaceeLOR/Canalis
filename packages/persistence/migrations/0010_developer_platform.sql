CREATE TABLE IF NOT EXISTS developer_api_keys (
  id TEXT PRIMARY KEY,
  owner_wallet TEXT NOT NULL,
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS developer_api_keys_owner_idx ON developer_api_keys(owner_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS developer_api_keys_prefix_idx ON developer_api_keys(token_prefix);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id TEXT PRIMARY KEY,
  owner_wallet TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  secret_envelope JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS webhook_subscriptions_owner_idx ON webhook_subscriptions(owner_wallet, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  owner_wallet TEXT NOT NULL,
  event_type TEXT NOT NULL,
  api_version TEXT NOT NULL DEFAULT 'v1',
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS webhook_events_owner_idx ON webhook_events(owner_wallet, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  response_status INTEGER,
  error_code TEXT,
  next_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, subscription_id, attempt)
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_subscription_idx ON webhook_deliveries(subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_retry_idx ON webhook_deliveries(status, next_attempt_at) WHERE status = 'failed';

DROP TRIGGER IF EXISTS audit_developer_api_keys ON developer_api_keys;
CREATE TRIGGER audit_developer_api_keys AFTER INSERT OR UPDATE OR DELETE ON developer_api_keys
FOR EACH ROW EXECUTE FUNCTION canalis_capture_audit_event();

DROP TRIGGER IF EXISTS audit_webhook_subscriptions ON webhook_subscriptions;
CREATE TRIGGER audit_webhook_subscriptions AFTER INSERT OR UPDATE OR DELETE ON webhook_subscriptions
FOR EACH ROW EXECUTE FUNCTION canalis_capture_audit_event();
