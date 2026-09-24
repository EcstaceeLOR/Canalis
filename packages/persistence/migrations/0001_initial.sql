CREATE TABLE IF NOT EXISTS canalis_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payee TEXT NOT NULL,
  protocol TEXT NOT NULL,
  mode TEXT NOT NULL,
  description TEXT NOT NULL,
  endpoint TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  mint TEXT NOT NULL,
  budget_atomic NUMERIC(78, 0) NOT NULL CHECK (budget_atomic > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at_unix BIGINT NOT NULL,
  expires_at_unix BIGINT NOT NULL,
  updated_at_unix BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  allowed_provider_ids JSONB NOT NULL,
  max_per_call_atomic NUMERIC(78, 0),
  provider_caps_atomic JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS channels (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  program_address TEXT NOT NULL,
  network TEXT NOT NULL,
  channel_address TEXT,
  ceiling_atomic NUMERIC(78, 0) NOT NULL CHECK (ceiling_atomic > 0),
  cumulative_authorized_atomic NUMERIC(78, 0) NOT NULL DEFAULT 0,
  spent_atomic NUMERIC(78, 0) NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  open_transaction_signature TEXT,
  settle_transaction_signature TEXT,
  distribution_transaction_signature TEXT,
  refund_transaction_signature TEXT,
  recovery_state JSONB,
  created_at_unix BIGINT NOT NULL,
  updated_at_unix BIGINT NOT NULL,
  PRIMARY KEY (task_id, provider_id)
);

CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  quoted_amount_atomic NUMERIC(78, 0) NOT NULL,
  previous_cumulative_atomic NUMERIC(78, 0) NOT NULL,
  next_cumulative_atomic NUMERIC(78, 0) NOT NULL,
  rejection_code TEXT,
  rejection_message TEXT,
  authorization_id TEXT,
  payment_reference TEXT,
  error_message TEXT,
  settlement_transaction_signature TEXT,
  created_at_unix BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
  flow_id TEXT PRIMARY KEY REFERENCES flows(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  request_id TEXT NOT NULL,
  mint TEXT NOT NULL,
  price_atomic NUMERIC(78, 0) NOT NULL,
  protocol TEXT NOT NULL,
  authorization_id TEXT NOT NULL,
  payment_reference TEXT,
  response_hash TEXT NOT NULL,
  timestamp_unix BIGINT NOT NULL,
  protocol_metadata JSONB
);

CREATE TABLE IF NOT EXISTS settlements (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  cumulative_amount_atomic NUMERIC(78, 0) NOT NULL,
  transaction_signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, provider_id, transaction_signature)
);

CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at_unix DESC);
CREATE INDEX IF NOT EXISTS idx_flows_task_created ON flows(task_id, created_at_unix);
CREATE INDEX IF NOT EXISTS idx_receipts_task ON receipts(task_id);
CREATE INDEX IF NOT EXISTS idx_settlements_task ON settlements(task_id);

INSERT INTO providers (id, name, payee, protocol, mode, description)
VALUES
  ('search', 'Canalis Search', 'demo:search', 'demo', 'deterministic', 'Deterministic search provider for the Canalis product reference flow.'),
  ('data', 'Canalis Data', 'demo:data', 'demo', 'deterministic', 'Deterministic structured-data provider for the Canalis product reference flow.'),
  ('inference', 'Canalis Inference', 'demo:inference', 'demo', 'deterministic', 'Deterministic inference provider for the Canalis product reference flow.')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  payee = EXCLUDED.payee,
  protocol = EXCLUDED.protocol,
  mode = EXCLUDED.mode,
  description = EXCLUDED.description,
  updated_at = NOW();
