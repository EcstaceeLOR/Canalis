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

CREATE OR REPLACE FUNCTION canalis_sanitize_audit_snapshot(
  table_name TEXT,
  snapshot JSONB
) RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF snapshot IS NULL THEN RETURN NULL; END IF;
  IF table_name = 'providers' THEN
    RETURN snapshot - 'secret_config' - 'config' - 'last_error_message';
  END IF;
  IF table_name = 'channels' THEN RETURN snapshot - 'recovery_state'; END IF;
  IF table_name = 'developer_api_keys' THEN RETURN snapshot - 'token_hash'; END IF;
  IF table_name = 'webhook_subscriptions' THEN RETURN snapshot - 'secret_envelope'; END IF;
  RETURN snapshot;
END;
$$;

CREATE OR REPLACE FUNCTION canalis_write_audit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  before_snapshot JSONB;
  after_snapshot JSONB;
  source_snapshot JSONB;
  audit_owner TEXT;
  audit_resource_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    before_snapshot := NULL;
    after_snapshot := canalis_sanitize_audit_snapshot(TG_TABLE_NAME, to_jsonb(NEW));
    source_snapshot := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    before_snapshot := canalis_sanitize_audit_snapshot(TG_TABLE_NAME, to_jsonb(OLD));
    after_snapshot := NULL;
    source_snapshot := to_jsonb(OLD);
  ELSE
    before_snapshot := canalis_sanitize_audit_snapshot(TG_TABLE_NAME, to_jsonb(OLD));
    after_snapshot := canalis_sanitize_audit_snapshot(TG_TABLE_NAME, to_jsonb(NEW));
    source_snapshot := to_jsonb(NEW);
  END IF;

  IF TG_TABLE_NAME = 'account_settings' THEN
    audit_owner := source_snapshot->>'owner_wallet'; audit_resource_id := source_snapshot->>'owner_wallet';
  ELSIF TG_TABLE_NAME IN ('providers', 'reusable_policy_definitions', 'developer_api_keys', 'webhook_subscriptions') THEN
    audit_owner := COALESCE(source_snapshot->>'owner_wallet', 'system'); audit_resource_id := source_snapshot->>'id';
  ELSIF TG_TABLE_NAME = 'reusable_policy_versions' THEN
    SELECT owner_wallet INTO audit_owner FROM reusable_policy_definitions WHERE id = source_snapshot->>'policy_id';
    audit_resource_id := (source_snapshot->>'policy_id') || ':v' || (source_snapshot->>'version');
  ELSIF TG_TABLE_NAME = 'tasks' THEN
    audit_owner := source_snapshot->>'owner'; audit_resource_id := source_snapshot->>'id';
  ELSIF TG_TABLE_NAME IN ('policies', 'channels', 'settlements') THEN
    SELECT owner INTO audit_owner FROM tasks WHERE id = source_snapshot->>'task_id';
    IF TG_TABLE_NAME = 'policies' THEN
      audit_resource_id := source_snapshot->>'task_id';
    ELSIF TG_TABLE_NAME = 'channels' THEN
      audit_resource_id := (source_snapshot->>'task_id') || ':' || (source_snapshot->>'provider_id');
    ELSE
      audit_resource_id := (source_snapshot->>'task_id') || ':' || (source_snapshot->>'provider_id') || ':' || COALESCE(source_snapshot->>'transaction_signature', 'pending');
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  INSERT INTO audit_events (owner_wallet, actor_wallet, resource_type, resource_id, action, before_state, after_state)
  VALUES (
    COALESCE(audit_owner, 'system'), COALESCE(audit_owner, 'system'), TG_TABLE_NAME,
    COALESCE(audit_resource_id, 'unknown'), lower(TG_OP), before_snapshot, after_snapshot
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canalis_audit_developer_api_keys ON developer_api_keys;
CREATE TRIGGER canalis_audit_developer_api_keys AFTER INSERT OR UPDATE OR DELETE ON developer_api_keys
FOR EACH ROW EXECUTE FUNCTION canalis_write_audit_event();

DROP TRIGGER IF EXISTS canalis_audit_webhook_subscriptions ON webhook_subscriptions;
CREATE TRIGGER canalis_audit_webhook_subscriptions AFTER INSERT OR UPDATE OR DELETE ON webhook_subscriptions
FOR EACH ROW EXECUTE FUNCTION canalis_write_audit_event();
