ALTER TABLE providers
  ADD COLUMN owner_wallet TEXT,
  ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN supported_networks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN supported_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN pricing_model TEXT NOT NULL DEFAULT 'challenge',
  ADD COLUMN fixed_price_atomic NUMERIC(78, 0),
  ADD COLUMN default_channel_ceiling_atomic NUMERIC(78, 0),
  ADD COLUMN policy_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN secret_config JSONB,
  ADD COLUMN credential_kind TEXT,
  ADD COLUMN credential_header_name TEXT,
  ADD COLUMN last_health_check_at_unix BIGINT,
  ADD COLUMN last_success_at_unix BIGINT,
  ADD COLUMN last_error_at_unix BIGINT,
  ADD COLUMN last_error_code TEXT,
  ADD COLUMN last_error_message TEXT;

-- Rows that predate wallet-scoped provider ownership are retained as protected
-- system rows rather than being assigned to an arbitrary wallet or breaking the
-- migration with a new ownership constraint.
UPDATE providers
SET is_system = TRUE
WHERE owner_wallet IS NULL;

UPDATE providers
SET status = 'active',
    health_status = 'healthy',
    supported_networks = '["application"]'::jsonb,
    supported_assets = '["USDC"]'::jsonb,
    pricing_model = 'fixed',
    fixed_price_atomic = CASE id
      WHEN 'search' THEN 50000
      WHEN 'data' THEN 30000
      WHEN 'inference' THEN 120000
      ELSE fixed_price_atomic
    END,
    default_channel_ceiling_atomic = COALESCE(default_channel_ceiling_atomic, 250000),
    policy_metadata = jsonb_build_object('managedBy', 'canalis', 'kind', 'deterministic'),
    updated_at = NOW()
WHERE id IN ('search', 'data', 'inference');

ALTER TABLE providers
  ADD CONSTRAINT providers_status_check CHECK (status IN ('active', 'disabled')),
  ADD CONSTRAINT providers_health_status_check CHECK (health_status IN ('unknown', 'healthy', 'unhealthy')),
  ADD CONSTRAINT providers_pricing_model_check CHECK (pricing_model IN ('fixed', 'challenge', 'metered')),
  ADD CONSTRAINT providers_credential_kind_check CHECK (credential_kind IS NULL OR credential_kind IN ('bearer', 'api-key')),
  ADD CONSTRAINT providers_fixed_price_positive CHECK (fixed_price_atomic IS NULL OR fixed_price_atomic > 0),
  ADD CONSTRAINT providers_channel_ceiling_positive CHECK (default_channel_ceiling_atomic IS NULL OR default_channel_ceiling_atomic > 0),
  ADD CONSTRAINT providers_owner_check CHECK (is_system OR owner_wallet IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_providers_owner_status ON providers(owner_wallet, status);
CREATE INDEX IF NOT EXISTS idx_providers_health ON providers(health_status, status);
