CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  signing_wallet TEXT NOT NULL UNIQUE,
  created_by_wallet TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
  added_by_wallet TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, wallet_address)
);
CREATE INDEX IF NOT EXISTS workspace_members_wallet_idx ON workspace_members(wallet_address, workspace_id);

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
  invited_by_wallet TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workspace_invitations_wallet_idx ON workspace_invitations(wallet_address, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_pending_unique
  ON workspace_invitations(workspace_id, wallet_address)
  WHERE status = 'pending';

WITH wallets AS (
  SELECT owner AS wallet FROM tasks
  UNION SELECT owner_wallet FROM providers WHERE owner_wallet IS NOT NULL
  UNION SELECT owner_wallet FROM reusable_policy_definitions
  UNION SELECT owner_wallet FROM account_settings
  UNION SELECT owner_wallet FROM developer_api_keys
  UNION SELECT owner_wallet FROM webhook_subscriptions
  UNION SELECT owner_wallet FROM activity_events
  UNION SELECT owner_wallet FROM audit_events WHERE owner_wallet <> 'system'
)
INSERT INTO workspaces (id, name, slug, signing_wallet, created_by_wallet)
SELECT
  'ws_' || substr(md5(wallet), 1, 24),
  'Workspace ' || left(wallet, 6),
  'wallet-' || substr(md5(wallet), 1, 24),
  wallet,
  wallet
FROM wallets
WHERE wallet IS NOT NULL AND wallet <> '' AND wallet <> 'system'
ON CONFLICT (signing_wallet) DO NOTHING;

INSERT INTO workspace_members (workspace_id, wallet_address, role, added_by_wallet)
SELECT id, signing_wallet, 'owner', signing_wallet
FROM workspaces
ON CONFLICT (workspace_id, wallet_address) DO NOTHING;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE providers ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE reusable_policy_definitions ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE account_settings ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE developer_api_keys ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);

UPDATE tasks t SET workspace_id = w.id FROM workspaces w
WHERE t.workspace_id IS NULL AND w.signing_wallet = t.owner;
UPDATE providers p SET workspace_id = w.id FROM workspaces w
WHERE p.workspace_id IS NULL AND p.owner_wallet IS NOT NULL AND w.signing_wallet = p.owner_wallet;
UPDATE reusable_policy_definitions p SET workspace_id = w.id FROM workspaces w
WHERE p.workspace_id IS NULL AND w.signing_wallet = p.owner_wallet;
UPDATE account_settings s SET workspace_id = w.id FROM workspaces w
WHERE s.workspace_id IS NULL AND w.signing_wallet = s.owner_wallet;
UPDATE developer_api_keys k SET workspace_id = w.id FROM workspaces w
WHERE k.workspace_id IS NULL AND w.signing_wallet = k.owner_wallet;
UPDATE webhook_subscriptions s SET workspace_id = w.id FROM workspaces w
WHERE s.workspace_id IS NULL AND w.signing_wallet = s.owner_wallet;
UPDATE webhook_events e SET workspace_id = w.id FROM workspaces w
WHERE e.workspace_id IS NULL AND w.signing_wallet = e.owner_wallet;
UPDATE activity_events a SET workspace_id = w.id FROM workspaces w
WHERE a.workspace_id IS NULL AND w.signing_wallet = a.owner_wallet;
UPDATE audit_events a SET workspace_id = w.id FROM workspaces w
WHERE a.workspace_id IS NULL AND w.signing_wallet = a.owner_wallet;

ALTER TABLE tasks ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE reusable_policy_definitions ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE account_settings ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE developer_api_keys ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE webhook_subscriptions ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE webhook_events ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE activity_events ALTER COLUMN workspace_id SET NOT NULL;

CREATE OR REPLACE FUNCTION canalis_assign_workspace_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  tenant_wallet TEXT;
  tenant_workspace TEXT;
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    tenant_wallet := NEW.owner;
  ELSE
    tenant_wallet := NEW.owner_wallet;
  END IF;

  IF tenant_wallet IS NULL OR tenant_wallet = '' OR tenant_wallet = 'system' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO tenant_workspace
  FROM workspaces
  WHERE signing_wallet = tenant_wallet
  LIMIT 1;

  IF tenant_workspace IS NULL THEN
    INSERT INTO workspaces (id, name, slug, signing_wallet, created_by_wallet)
    VALUES (
      'ws_' || substr(md5(tenant_wallet), 1, 24),
      'Workspace ' || left(tenant_wallet, 6),
      'wallet-' || substr(md5(tenant_wallet), 1, 24),
      tenant_wallet,
      tenant_wallet
    )
    ON CONFLICT (signing_wallet) DO UPDATE SET signing_wallet = EXCLUDED.signing_wallet
    RETURNING id INTO tenant_workspace;

    INSERT INTO workspace_members (workspace_id, wallet_address, role, added_by_wallet)
    VALUES (tenant_workspace, tenant_wallet, 'owner', tenant_wallet)
    ON CONFLICT (workspace_id, wallet_address) DO NOTHING;
  END IF;

  NEW.workspace_id := tenant_workspace;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canalis_workspace_tasks ON tasks;
CREATE TRIGGER canalis_workspace_tasks BEFORE INSERT OR UPDATE OF owner ON tasks
FOR EACH ROW EXECUTE FUNCTION canalis_assign_workspace_id();
DROP TRIGGER IF EXISTS canalis_workspace_providers ON providers;
CREATE TRIGGER canalis_workspace_providers BEFORE INSERT OR UPDATE OF owner_wallet ON providers
FOR EACH ROW EXECUTE FUNCTION canalis_assign_workspace_id();
DROP TRIGGER IF EXISTS canalis_workspace_reusable_policies ON reusable_policy_definitions;
CREATE TRIGGER canalis_workspace_reusable_policies BEFORE INSERT OR UPDATE OF owner_wallet ON reusable_policy_definitions
FOR EACH ROW EXECUTE FUNCTION canalis_assign_workspace_id();
DROP TRIGGER IF EXISTS canalis_workspace_account_settings ON account_settings;
CREATE TRIGGER canalis_workspace_account_settings BEFORE INSERT OR UPDATE OF owner_wallet ON account_settings
FOR EACH ROW EXECUTE FUNCTION canalis_assign_workspace_id();
DROP TRIGGER IF EXISTS canalis_workspace_developer_keys ON developer_api_keys;
CREATE TRIGGER canalis_workspace_developer_keys BEFORE INSERT OR UPDATE OF owner_wallet ON developer_api_keys
FOR EACH ROW EXECUTE FUNCTION canalis_assign_workspace_id();
DROP TRIGGER IF EXISTS canalis_workspace_webhook_subscriptions ON webhook_subscriptions;
CREATE TRIGGER canalis_workspace_webhook_subscriptions BEFORE INSERT OR UPDATE OF owner_wallet ON webhook_subscriptions
FOR EACH ROW EXECUTE FUNCTION canalis_assign_workspace_id();
DROP TRIGGER IF EXISTS canalis_workspace_webhook_events ON webhook_events;
CREATE TRIGGER canalis_workspace_webhook_events BEFORE INSERT OR UPDATE OF owner_wallet ON webhook_events
FOR EACH ROW EXECUTE FUNCTION canalis_assign_workspace_id();
DROP TRIGGER IF EXISTS canalis_workspace_activity_events ON activity_events;
CREATE TRIGGER canalis_workspace_activity_events BEFORE INSERT OR UPDATE OF owner_wallet ON activity_events
FOR EACH ROW EXECUTE FUNCTION canalis_assign_workspace_id();

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
  audit_workspace TEXT;
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
    audit_owner := source_snapshot->>'owner_wallet'; audit_resource_id := source_snapshot->>'owner_wallet'; audit_workspace := source_snapshot->>'workspace_id';
  ELSIF TG_TABLE_NAME IN ('providers', 'reusable_policy_definitions', 'developer_api_keys', 'webhook_subscriptions') THEN
    audit_owner := COALESCE(source_snapshot->>'owner_wallet', 'system'); audit_resource_id := source_snapshot->>'id'; audit_workspace := source_snapshot->>'workspace_id';
  ELSIF TG_TABLE_NAME = 'reusable_policy_versions' THEN
    SELECT owner_wallet, workspace_id INTO audit_owner, audit_workspace FROM reusable_policy_definitions WHERE id = source_snapshot->>'policy_id';
    audit_resource_id := (source_snapshot->>'policy_id') || ':v' || (source_snapshot->>'version');
  ELSIF TG_TABLE_NAME = 'tasks' THEN
    audit_owner := source_snapshot->>'owner'; audit_resource_id := source_snapshot->>'id'; audit_workspace := source_snapshot->>'workspace_id';
  ELSIF TG_TABLE_NAME IN ('policies', 'channels', 'settlements') THEN
    SELECT owner, workspace_id INTO audit_owner, audit_workspace FROM tasks WHERE id = source_snapshot->>'task_id';
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

  INSERT INTO audit_events (owner_wallet, actor_wallet, workspace_id, resource_type, resource_id, action, before_state, after_state)
  VALUES (
    COALESCE(audit_owner, 'system'), COALESCE(audit_owner, 'system'), audit_workspace,
    TG_TABLE_NAME, COALESCE(audit_resource_id, 'unknown'), lower(TG_OP), before_snapshot, after_snapshot
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS tasks_workspace_idx ON tasks(workspace_id, updated_at_unix DESC);
CREATE INDEX IF NOT EXISTS providers_workspace_idx ON providers(workspace_id, status);
CREATE INDEX IF NOT EXISTS reusable_policies_workspace_idx ON reusable_policy_definitions(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS developer_api_keys_workspace_idx ON developer_api_keys(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_subscriptions_workspace_idx ON webhook_subscriptions(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_workspace_idx ON webhook_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_workspace_idx ON activity_events(workspace_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_workspace_idx ON audit_events(workspace_id, created_at DESC);
