import { defaultAccountSettings, type AccountSettings } from "@canalis/application";
import postgres, { type Sql } from "postgres";

function unixFromTimestamp(value: unknown): string {
  if (value instanceof Date) return String(Math.floor(value.getTime() / 1000));
  return String(Math.floor(new Date(String(value)).getTime() / 1000));
}

function mapSettings(row: Record<string, unknown>): AccountSettings {
  return {
    ownerWallet: String(row.owner_wallet),
    displayName: String(row.display_name ?? ""),
    environment: String(row.environment) as AccountSettings["environment"],
    solanaNetwork: String(row.solana_network) as AccountSettings["solanaNetwork"],
    defaultAssetSymbol: String(row.default_asset_symbol),
    ...(row.default_asset_mint ? { defaultAssetMint: String(row.default_asset_mint) } : {}),
    explorerCluster: String(row.explorer_cluster) as AccountSettings["explorerCluster"],
    taskDefaults: {
      agentId: String(row.default_agent_id),
      executionMode: String(row.default_execution_mode) as AccountSettings["taskDefaults"]["executionMode"],
      ...(row.default_policy_id ? { defaultPolicyId: String(row.default_policy_id) } : {}),
      saveAsDraft: row.save_as_draft === true,
    },
    notifications: {
      taskFailures: row.notify_task_failures === true,
      providerIncidents: row.notify_provider_incidents === true,
      settlementFailures: row.notify_settlement_failures === true,
      recoveryRequired: row.notify_recovery_required === true,
    },
    product: {
      autoRefreshSeconds: Number(row.auto_refresh_seconds ?? 30),
      compactTables: row.compact_tables === true,
      showAdvancedMetadata: row.show_advanced_metadata === true,
    },
    mainnetAcknowledged: row.mainnet_acknowledged === true,
    updatedAtUnixSeconds: unixFromTimestamp(row.updated_at),
  };
}

export class PostgresSettingsRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 5, prepare: false });
  }

  async get(ownerWallet: string): Promise<AccountSettings> {
    const defaults = defaultAccountSettings(ownerWallet);
    await this.sql`
      INSERT INTO account_settings (
        owner_wallet, display_name, environment, solana_network, default_asset_symbol,
        explorer_cluster, default_agent_id, default_execution_mode, save_as_draft,
        notify_task_failures, notify_provider_incidents, notify_settlement_failures,
        notify_recovery_required, auto_refresh_seconds, compact_tables,
        show_advanced_metadata, mainnet_acknowledged
      ) VALUES (
        ${ownerWallet}, ${defaults.displayName}, ${defaults.environment}, ${defaults.solanaNetwork},
        ${defaults.defaultAssetSymbol}, ${defaults.explorerCluster}, ${defaults.taskDefaults.agentId},
        ${defaults.taskDefaults.executionMode}, ${defaults.taskDefaults.saveAsDraft},
        ${defaults.notifications.taskFailures}, ${defaults.notifications.providerIncidents},
        ${defaults.notifications.settlementFailures}, ${defaults.notifications.recoveryRequired},
        ${defaults.product.autoRefreshSeconds}, ${defaults.product.compactTables},
        ${defaults.product.showAdvancedMetadata}, ${defaults.mainnetAcknowledged}
      )
      ON CONFLICT (owner_wallet) DO NOTHING
    `;
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM account_settings WHERE owner_wallet = ${ownerWallet} LIMIT 1
    `;
    if (!rows[0]) throw new Error("Account settings could not be loaded.");
    return mapSettings(rows[0]);
  }

  async save(settings: AccountSettings): Promise<AccountSettings> {
    await this.sql`
      INSERT INTO account_settings (
        owner_wallet, display_name, environment, solana_network, default_asset_symbol,
        default_asset_mint, explorer_cluster, default_agent_id, default_execution_mode,
        default_policy_id, save_as_draft, notify_task_failures, notify_provider_incidents,
        notify_settlement_failures, notify_recovery_required, auto_refresh_seconds,
        compact_tables, show_advanced_metadata, mainnet_acknowledged, updated_at
      ) VALUES (
        ${settings.ownerWallet}, ${settings.displayName}, ${settings.environment}, ${settings.solanaNetwork},
        ${settings.defaultAssetSymbol}, ${settings.defaultAssetMint ?? null}, ${settings.explorerCluster},
        ${settings.taskDefaults.agentId}, ${settings.taskDefaults.executionMode},
        ${settings.taskDefaults.defaultPolicyId ?? null}, ${settings.taskDefaults.saveAsDraft},
        ${settings.notifications.taskFailures}, ${settings.notifications.providerIncidents},
        ${settings.notifications.settlementFailures}, ${settings.notifications.recoveryRequired},
        ${settings.product.autoRefreshSeconds}, ${settings.product.compactTables},
        ${settings.product.showAdvancedMetadata}, ${settings.mainnetAcknowledged}, NOW()
      )
      ON CONFLICT (owner_wallet) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        environment = EXCLUDED.environment,
        solana_network = EXCLUDED.solana_network,
        default_asset_symbol = EXCLUDED.default_asset_symbol,
        default_asset_mint = EXCLUDED.default_asset_mint,
        explorer_cluster = EXCLUDED.explorer_cluster,
        default_agent_id = EXCLUDED.default_agent_id,
        default_execution_mode = EXCLUDED.default_execution_mode,
        default_policy_id = EXCLUDED.default_policy_id,
        save_as_draft = EXCLUDED.save_as_draft,
        notify_task_failures = EXCLUDED.notify_task_failures,
        notify_provider_incidents = EXCLUDED.notify_provider_incidents,
        notify_settlement_failures = EXCLUDED.notify_settlement_failures,
        notify_recovery_required = EXCLUDED.notify_recovery_required,
        auto_refresh_seconds = EXCLUDED.auto_refresh_seconds,
        compact_tables = EXCLUDED.compact_tables,
        show_advanced_metadata = EXCLUDED.show_advanced_metadata,
        mainnet_acknowledged = EXCLUDED.mainnet_acknowledged,
        updated_at = NOW()
    `;
    return this.get(settings.ownerWallet);
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
