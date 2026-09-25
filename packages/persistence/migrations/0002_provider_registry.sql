ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS supported_assets JSONB NOT NULL DEFAULT '["USDC"]'::jsonb,
  ADD COLUMN IF NOT EXISTS supported_networks JSONB NOT NULL DEFAULT '["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"]'::jsonb,
  ADD COLUMN IF NOT EXISTS pricing_model JSONB NOT NULL DEFAULT '{"kind":"fixed-per-call","amountAtomic":"0","mint":"USDC"}'::jsonb,
  ADD COLUMN IF NOT EXISTS default_channel_ceiling_atomic NUMERIC(78, 0),
  ADD COLUMN IF NOT EXISTS health_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS health_message TEXT,
  ADD COLUMN IF NOT EXISTS last_health_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS secret_config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE providers
  DROP CONSTRAINT IF EXISTS providers_health_status_check;
ALTER TABLE providers
  ADD CONSTRAINT providers_health_status_check
  CHECK (health_status IN ('unknown', 'healthy', 'unhealthy'));

ALTER TABLE providers
  DROP CONSTRAINT IF EXISTS providers_protocol_check;
ALTER TABLE providers
  ADD CONSTRAINT providers_protocol_check
  CHECK (protocol IN ('demo', 'x402', 'mpp'));

ALTER TABLE providers
  DROP CONSTRAINT IF EXISTS providers_mode_check;
ALTER TABLE providers
  ADD CONSTRAINT providers_mode_check
  CHECK (mode IN ('deterministic', 'x402', 'mpp'));

CREATE INDEX IF NOT EXISTS idx_providers_enabled_health
  ON providers(enabled, health_status);

UPDATE providers
SET
  enabled = TRUE,
  supported_assets = CASE
    WHEN mode = 'x402' THEN '["9Bwb6mKX9R2nF7WQhB4G6tMJDVf2YsTgP4KSZxnqsjHG"]'::jsonb
    ELSE '["USDC"]'::jsonb
  END,
  supported_networks = '["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"]'::jsonb,
  pricing_model = CASE id
    WHEN 'search' THEN '{"kind":"fixed-per-call","amountAtomic":"50000","mint":"USDC"}'::jsonb
    WHEN 'data' THEN '{"kind":"fixed-per-call","amountAtomic":"30000","mint":"USDC"}'::jsonb
    WHEN 'inference' THEN '{"kind":"fixed-per-call","amountAtomic":"120000","mint":"USDC"}'::jsonb
    ELSE pricing_model
  END,
  default_channel_ceiling_atomic = CASE id
    WHEN 'search' THEN 333334
    WHEN 'data' THEN 333333
    WHEN 'inference' THEN 333333
    ELSE default_channel_ceiling_atomic
  END,
  health_status = 'healthy',
  health_message = 'Built-in deterministic provider is available locally.',
  last_health_at = NOW(),
  last_success_at = NOW(),
  updated_at = NOW()
WHERE id IN ('search', 'data', 'inference');