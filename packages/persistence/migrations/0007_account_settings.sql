CREATE TABLE IF NOT EXISTS account_settings (
  owner_wallet TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT 'devnet' CHECK (environment IN ('local', 'devnet', 'mainnet')),
  solana_network TEXT NOT NULL DEFAULT 'devnet' CHECK (solana_network IN ('localnet', 'devnet', 'mainnet-beta')),
  default_asset_symbol TEXT NOT NULL DEFAULT 'USDC',
  default_asset_mint TEXT,
  explorer_cluster TEXT NOT NULL DEFAULT 'devnet' CHECK (explorer_cluster IN ('localnet', 'devnet', 'mainnet-beta')),
  default_agent_id TEXT NOT NULL DEFAULT 'canalis-agent',
  default_execution_mode TEXT NOT NULL DEFAULT 'deterministic' CHECK (default_execution_mode IN ('deterministic', 'x402', 'mpp')),
  default_policy_id TEXT,
  save_as_draft BOOLEAN NOT NULL DEFAULT FALSE,
  notify_task_failures BOOLEAN NOT NULL DEFAULT TRUE,
  notify_provider_incidents BOOLEAN NOT NULL DEFAULT TRUE,
  notify_settlement_failures BOOLEAN NOT NULL DEFAULT TRUE,
  notify_recovery_required BOOLEAN NOT NULL DEFAULT TRUE,
  auto_refresh_seconds INTEGER NOT NULL DEFAULT 30 CHECK (auto_refresh_seconds BETWEEN 0 AND 300),
  compact_tables BOOLEAN NOT NULL DEFAULT FALSE,
  show_advanced_metadata BOOLEAN NOT NULL DEFAULT FALSE,
  mainnet_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT account_settings_environment_network_check CHECK (
    (environment = 'local' AND solana_network = 'localnet' AND explorer_cluster = 'localnet') OR
    (environment = 'devnet' AND solana_network = 'devnet' AND explorer_cluster = 'devnet') OR
    (environment = 'mainnet' AND solana_network = 'mainnet-beta' AND explorer_cluster = 'mainnet-beta')
  ),
  CONSTRAINT account_settings_mainnet_safety_check CHECK (
    environment <> 'mainnet' OR (
      mainnet_acknowledged = TRUE AND
      default_asset_mint IS NOT NULL AND
      default_execution_mode <> 'deterministic'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_account_settings_environment
  ON account_settings(environment, solana_network);
