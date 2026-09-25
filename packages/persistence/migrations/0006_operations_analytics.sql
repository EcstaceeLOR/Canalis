CREATE INDEX IF NOT EXISTS idx_tasks_owner_created
  ON tasks(owner, created_at_unix DESC);

CREATE INDEX IF NOT EXISTS idx_receipts_timestamp_task
  ON receipts(timestamp_unix DESC, task_id);

CREATE INDEX IF NOT EXISTS idx_flows_created_task_status
  ON flows(created_at_unix DESC, task_id, status);

CREATE INDEX IF NOT EXISTS idx_channels_updated_task
  ON channels(updated_at_unix DESC, task_id);

CREATE INDEX IF NOT EXISTS idx_providers_owner_health
  ON providers(owner_wallet, status, health_status)
  WHERE is_system = FALSE;
