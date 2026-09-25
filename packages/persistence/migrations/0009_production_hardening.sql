CREATE TABLE IF NOT EXISTS idempotency_records (
  owner_wallet TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress', 'completed')),
  response_status INTEGER,
  response_body TEXT,
  response_content_type TEXT,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_wallet, operation, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expiry
  ON idempotency_records(expires_at);

CREATE TABLE IF NOT EXISTS mutation_locks (
  resource_key TEXT PRIMARY KEY,
  owner_wallet TEXT NOT NULL,
  operation TEXT NOT NULL,
  holder_key TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mutation_locks_expiry
  ON mutation_locks(expires_at);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  scope_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  owner_wallet TEXT NOT NULL,
  actor_wallet TEXT,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_owner_created
  ON audit_events(owner_wallet, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource
  ON audit_events(resource_type, resource_id, created_at DESC);

CREATE OR REPLACE FUNCTION canalis_sanitize_audit_snapshot(
  table_name TEXT,
  snapshot JSONB
) RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF snapshot IS NULL THEN
    RETURN NULL;
  END IF;

  IF table_name = 'providers' THEN
    RETURN snapshot - 'secret_config' - 'config';
  END IF;

  IF table_name = 'channels' THEN
    RETURN snapshot - 'recovery_state';
  END IF;

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
    audit_owner := source_snapshot->>'owner_wallet';
    audit_resource_id := source_snapshot->>'owner_wallet';
  ELSIF TG_TABLE_NAME = 'providers' THEN
    audit_owner := COALESCE(source_snapshot->>'owner_wallet', 'system');
    audit_resource_id := source_snapshot->>'id';
  ELSIF TG_TABLE_NAME = 'reusable_policy_definitions' THEN
    audit_owner := source_snapshot->>'owner_wallet';
    audit_resource_id := source_snapshot->>'id';
  ELSIF TG_TABLE_NAME = 'reusable_policy_versions' THEN
    SELECT owner_wallet INTO audit_owner
    FROM reusable_policy_definitions
    WHERE id = source_snapshot->>'policy_id';
    audit_resource_id := (source_snapshot->>'policy_id') || ':v' || (source_snapshot->>'version');
  ELSIF TG_TABLE_NAME = 'tasks' THEN
    audit_owner := source_snapshot->>'owner';
    audit_resource_id := source_snapshot->>'id';
  ELSIF TG_TABLE_NAME IN ('policies', 'channels', 'settlements') THEN
    SELECT owner INTO audit_owner
    FROM tasks
    WHERE id = source_snapshot->>'task_id';
    IF TG_TABLE_NAME = 'policies' THEN
      audit_resource_id := source_snapshot->>'task_id';
    ELSIF TG_TABLE_NAME = 'channels' THEN
      audit_resource_id := (source_snapshot->>'task_id') || ':' || (source_snapshot->>'provider_id');
    ELSE
      audit_resource_id := (source_snapshot->>'task_id') || ':' || (source_snapshot->>'provider_id') || ':' || COALESCE(source_snapshot->>'transaction_signature', 'pending');
    END IF;
  ELSE
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  INSERT INTO audit_events (
    owner_wallet,
    actor_wallet,
    resource_type,
    resource_id,
    action,
    before_state,
    after_state
  ) VALUES (
    COALESCE(audit_owner, 'system'),
    COALESCE(audit_owner, 'system'),
    TG_TABLE_NAME,
    COALESCE(audit_resource_id, 'unknown'),
    lower(TG_OP),
    before_snapshot,
    after_snapshot
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION canalis_prevent_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION canalis_prevent_audit_mutation();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'account_settings',
    'providers',
    'reusable_policy_definitions',
    'reusable_policy_versions',
    'tasks',
    'policies',
    'channels',
    'settlements'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS canalis_audit_%I ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER canalis_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION canalis_write_audit_event()',
      table_name,
      table_name
    );
  END LOOP;
END;
$$;
