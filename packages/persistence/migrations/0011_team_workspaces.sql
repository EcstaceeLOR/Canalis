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

-- Preserve every existing wallet-scoped tenant as a personal workspace. The
-- signing wallet remains the canonical on-chain authority; workspace IDs are
-- the collaboration boundary layered around that signer.
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

CREATE INDEX IF NOT EXISTS tasks_workspace_idx ON tasks(workspace_id, updated_at_unix DESC);
CREATE INDEX IF NOT EXISTS providers_workspace_idx ON providers(workspace_id, status);
CREATE INDEX IF NOT EXISTS reusable_policies_workspace_idx ON reusable_policy_definitions(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS developer_api_keys_workspace_idx ON developer_api_keys(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_subscriptions_workspace_idx ON webhook_subscriptions(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_workspace_idx ON webhook_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_workspace_idx ON activity_events(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_workspace_idx ON audit_events(workspace_id, created_at DESC);
