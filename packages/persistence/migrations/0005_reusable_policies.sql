CREATE TABLE IF NOT EXISTS reusable_policy_definitions (
  id TEXT PRIMARY KEY,
  owner_wallet TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  latest_version INTEGER NOT NULL DEFAULT 1 CHECK (latest_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reusable_policy_versions (
  policy_id TEXT NOT NULL REFERENCES reusable_policy_definitions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  total_ceiling_atomic NUMERIC(78, 0) NOT NULL CHECK (total_ceiling_atomic > 0),
  max_per_call_atomic NUMERIC(78, 0) NOT NULL CHECK (max_per_call_atomic > 0),
  allowed_provider_ids JSONB NOT NULL,
  blocked_provider_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_caps_atomic JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 10080),
  allowed_networks JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_mints JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_protocols JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (policy_id, version)
);

ALTER TABLE policies
  ADD COLUMN IF NOT EXISTS policy_definition_id TEXT REFERENCES reusable_policy_definitions(id),
  ADD COLUMN IF NOT EXISTS policy_version INTEGER,
  ADD COLUMN IF NOT EXISTS policy_name TEXT,
  ADD COLUMN IF NOT EXISTS total_ceiling_atomic NUMERIC(78, 0),
  ADD COLUMN IF NOT EXISTS blocked_provider_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS allowed_networks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS allowed_mints JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS allowed_protocols JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE policies p
SET policy_name = COALESCE(policy_name, 'Inline bounded policy'),
    total_ceiling_atomic = COALESCE(total_ceiling_atomic, t.budget_atomic),
    allowed_protocols = CASE
      WHEN jsonb_array_length(allowed_protocols) > 0 THEN allowed_protocols
      WHEN t.mode = 'deterministic' THEN '["demo"]'::jsonb
      ELSE jsonb_build_array(t.mode)
    END
FROM tasks t
WHERE p.task_id = t.id;

-- Keep total_ceiling_atomic nullable for legacy/imported task-policy rows that
-- predate reusable-policy snapshots. The canonical task budget remains in
-- tasks.budget_atomic, while all new Canalis task creation paths persist the
-- resolved snapshot value explicitly.
ALTER TABLE policies
  ALTER COLUMN policy_name SET DEFAULT 'Inline bounded policy';

CREATE INDEX IF NOT EXISTS idx_reusable_policy_owner_status
  ON reusable_policy_definitions(owner_wallet, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_policy_source
  ON policies(policy_definition_id, policy_version);
