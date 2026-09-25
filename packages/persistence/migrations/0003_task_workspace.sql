ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('draft', 'active', 'completed', 'cancelled', 'archived'));

CREATE TABLE IF NOT EXISTS task_workspace_metadata (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  policy_id TEXT NOT NULL DEFAULT 'inline-bounded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO task_workspace_metadata (task_id, name, description, policy_id)
SELECT id, agent_id, '', 'inline-bounded'
FROM tasks
ON CONFLICT (task_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_tasks_owner_updated
  ON tasks(owner, updated_at_unix DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_status_updated
  ON tasks(owner, status, updated_at_unix DESC);
CREATE INDEX IF NOT EXISTS idx_channels_provider_task
  ON channels(provider_id, task_id);
CREATE INDEX IF NOT EXISTS idx_task_workspace_name
  ON task_workspace_metadata(LOWER(name));
