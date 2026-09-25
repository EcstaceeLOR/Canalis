import {
  ApplicationError,
  parseUsdc,
  providerModeForProtocol,
  type JsonObject,
  type ProviderHealthResult,
  type ProviderRegistryCreateInput,
  type ProviderRegistryRecord,
  type ProviderRegistryStatus,
  type ProviderRegistryUpdateInput,
} from "@canalis/application";
import postgres, { type Sql } from "postgres";

export type ProviderSecretEnvelope = JsonObject;
export type ProviderCredentialMutation =
  | { kind: "bearer" | "api-key"; headerName?: string; envelope: ProviderSecretEnvelope }
  | null
  | undefined;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined || String(value) === "" ? undefined : String(value);
}

function unixFromTimestamp(value: unknown): string {
  if (value instanceof Date) return String(Math.floor(value.getTime() / 1000));
  const date = new Date(String(value));
  return String(Math.floor(date.getTime() / 1000));
}

function mapProvider(row: Record<string, unknown>): ProviderRegistryRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    protocol: String(row.protocol) as ProviderRegistryRecord["protocol"],
    mode: String(row.mode) as ProviderRegistryRecord["mode"],
    ...(optionalString(row.endpoint) ? { endpoint: optionalString(row.endpoint) } : {}),
    payee: String(row.payee),
    ...(optionalString(row.owner_wallet) ? { ownerWallet: optionalString(row.owner_wallet) } : {}),
    systemManaged: row.is_system === true,
    status: String(row.status) as ProviderRegistryRecord["status"],
    healthStatus: String(row.health_status) as ProviderRegistryRecord["healthStatus"],
    supportedNetworks: stringArray(row.supported_networks),
    supportedAssets: stringArray(row.supported_assets),
    pricingModel: String(row.pricing_model) as ProviderRegistryRecord["pricingModel"],
    ...(optionalString(row.fixed_price_atomic) ? { fixedPriceAtomic: optionalString(row.fixed_price_atomic) } : {}),
    ...(optionalString(row.default_channel_ceiling_atomic)
      ? { defaultChannelCeilingAtomic: optionalString(row.default_channel_ceiling_atomic) }
      : {}),
    policyMetadata: jsonObject(row.policy_metadata),
    hasCredential: row.secret_config !== null && row.secret_config !== undefined,
    ...(optionalString(row.credential_kind)
      ? { credentialKind: optionalString(row.credential_kind) as "bearer" | "api-key" }
      : {}),
    ...(optionalString(row.credential_header_name)
      ? { credentialHeaderName: optionalString(row.credential_header_name) }
      : {}),
    ...(optionalString(row.last_health_check_at_unix)
      ? { lastHealthCheckAtUnixSeconds: optionalString(row.last_health_check_at_unix) }
      : {}),
    ...(optionalString(row.last_success_at_unix)
      ? { lastSuccessAtUnixSeconds: optionalString(row.last_success_at_unix) }
      : {}),
    ...(optionalString(row.last_error_at_unix)
      ? { lastErrorAtUnixSeconds: optionalString(row.last_error_at_unix) }
      : {}),
    ...(optionalString(row.last_error_code) ? { lastErrorCode: optionalString(row.last_error_code) } : {}),
    ...(optionalString(row.last_error_message) ? { lastErrorMessage: optionalString(row.last_error_message) } : {}),
    createdAtUnixSeconds: unixFromTimestamp(row.created_at),
    updatedAtUnixSeconds: unixFromTimestamp(row.updated_at),
    usage: {
      tasks: Number(row.task_usage_count ?? 0),
      channels: Number(row.channel_usage_count ?? 0),
      flows: Number(row.flow_usage_count ?? 0),
    },
  };
}

const providerSelect = `
  SELECT pr.*,
    (SELECT COUNT(*)::int FROM policies po WHERE po.allowed_provider_ids ? pr.id) AS task_usage_count,
    (SELECT COUNT(*)::int FROM channels c WHERE c.provider_id = pr.id) AS channel_usage_count,
    (SELECT COUNT(*)::int FROM flows f WHERE f.provider_id = pr.id) AS flow_usage_count
  FROM providers pr
`;

export class PostgresProviderRegistryRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 5, prepare: false });
  }

  async listProviders(ownerWallet: string, selectableOnly = false): Promise<ProviderRegistryRecord[]> {
    const clauses = ["(pr.is_system = TRUE OR pr.owner_wallet = $1)"];
    const params: Array<string> = [ownerWallet];
    if (selectableOnly) {
      clauses.push("pr.status = 'active'");
      clauses.push("(pr.protocol = 'demo' OR pr.health_status = 'healthy')");
    }
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `${providerSelect} WHERE ${clauses.join(" AND ")} ORDER BY pr.is_system DESC, pr.name ASC`,
      params,
    );
    return rows.map(mapProvider);
  }

  async getProvider(providerId: string, ownerWallet: string): Promise<ProviderRegistryRecord | null> {
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `${providerSelect} WHERE pr.id = $1 AND (pr.is_system = TRUE OR pr.owner_wallet = $2) LIMIT 1`,
      [providerId, ownerWallet],
    );
    return rows[0] ? mapProvider(rows[0]) : null;
  }

  async getSecretEnvelope(
    providerId: string,
    ownerWallet: string,
  ): Promise<{ envelope: ProviderSecretEnvelope; kind: "bearer" | "api-key"; headerName?: string } | null> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT secret_config, credential_kind, credential_header_name
      FROM providers
      WHERE id = ${providerId} AND is_system = FALSE AND owner_wallet = ${ownerWallet}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row?.secret_config || !row.credential_kind) return null;
    return {
      envelope: jsonObject(row.secret_config),
      kind: String(row.credential_kind) as "bearer" | "api-key",
      ...(optionalString(row.credential_header_name)
        ? { headerName: optionalString(row.credential_header_name) }
        : {}),
    };
  }

  async createProvider(
    ownerWallet: string,
    input: ProviderRegistryCreateInput,
    credential?: Exclude<ProviderCredentialMutation, null | undefined>,
  ): Promise<ProviderRegistryRecord> {
    const conflict = await this.sql<{ id: string }[]>`
      SELECT id FROM providers WHERE id = ${input.id} LIMIT 1
    `;
    if (conflict.length > 0) {
      throw new ApplicationError(
        "PROVIDER_ID_TAKEN",
        "That provider ID is already in use. Choose another stable provider ID.",
        409,
      );
    }
    const fixed = input.fixedPriceUsd ? parseUsdc(input.fixedPriceUsd).toString() : null;
    const ceiling = input.defaultChannelCeilingUsd
      ? parseUsdc(input.defaultChannelCeilingUsd).toString()
      : null;
    const mode = providerModeForProtocol(input.protocol);
    await this.sql`
      INSERT INTO providers (
        id, name, payee, protocol, mode, description, endpoint, config,
        owner_wallet, is_system, status, health_status, supported_networks,
        supported_assets, pricing_model, fixed_price_atomic,
        default_channel_ceiling_atomic, policy_metadata, secret_config,
        credential_kind, credential_header_name
      ) VALUES (
        ${input.id}, ${input.name}, ${input.payee}, ${input.protocol}, ${mode},
        ${input.description}, ${input.endpoint ?? null}, '{}'::jsonb,
        ${ownerWallet}, FALSE, 'active', ${input.protocol === "demo" ? "healthy" : "unknown"},
        ${this.sql.json(input.supportedNetworks)}, ${this.sql.json(input.supportedAssets)},
        ${input.pricingModel}, ${fixed}, ${ceiling}, ${this.sql.json(input.policyMetadata)},
        ${credential ? this.sql.json(credential.envelope) : null},
        ${credential?.kind ?? null}, ${credential?.headerName ?? null}
      )
    `;
    const created = await this.getProvider(input.id, ownerWallet);
    if (!created) throw new Error("Provider was created but could not be reloaded.");
    return created;
  }

  async updateProvider(
    providerId: string,
    ownerWallet: string,
    input: ProviderRegistryUpdateInput,
    credentialMutation?: ProviderCredentialMutation,
  ): Promise<ProviderRegistryRecord> {
    const currentRows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM providers
      WHERE id = ${providerId} AND is_system = FALSE AND owner_wallet = ${ownerWallet}
      LIMIT 1
    `;
    const current = currentRows[0];
    if (!current) {
      throw new ApplicationError("PROVIDER_NOT_FOUND", "Provider not found or is system-managed.", 404);
    }

    const endpoint = input.endpoint === undefined ? optionalString(current.endpoint) : input.endpoint ?? undefined;
    const networks = input.supportedNetworks ?? stringArray(current.supported_networks);
    const assets = input.supportedAssets ?? stringArray(current.supported_assets);
    const pricingModel = input.pricingModel ?? String(current.pricing_model);
    const fixedPriceAtomic = input.fixedPriceUsd === undefined
      ? optionalString(current.fixed_price_atomic) ?? null
      : input.fixedPriceUsd === null ? null : parseUsdc(input.fixedPriceUsd).toString();
    const ceilingAtomic = input.defaultChannelCeilingUsd === undefined
      ? optionalString(current.default_channel_ceiling_atomic) ?? null
      : input.defaultChannelCeilingUsd === null ? null : parseUsdc(input.defaultChannelCeilingUsd).toString();
    const policyMetadata = input.policyMetadata ?? jsonObject(current.policy_metadata);

    let secretConfig: JsonObject | null = current.secret_config ? jsonObject(current.secret_config) : null;
    let credentialKind = optionalString(current.credential_kind) ?? null;
    let credentialHeaderName = optionalString(current.credential_header_name) ?? null;
    if (credentialMutation === null) {
      secretConfig = null;
      credentialKind = null;
      credentialHeaderName = null;
    } else if (credentialMutation) {
      secretConfig = credentialMutation.envelope;
      credentialKind = credentialMutation.kind;
      credentialHeaderName = credentialMutation.headerName ?? null;
    }

    await this.sql`
      UPDATE providers
      SET name = ${input.name ?? String(current.name)},
          description = ${input.description ?? String(current.description)},
          endpoint = ${endpoint ?? null},
          payee = ${input.payee ?? String(current.payee)},
          supported_networks = ${this.sql.json(networks)},
          supported_assets = ${this.sql.json(assets)},
          pricing_model = ${pricingModel},
          fixed_price_atomic = ${fixedPriceAtomic},
          default_channel_ceiling_atomic = ${ceilingAtomic},
          policy_metadata = ${this.sql.json(policyMetadata)},
          secret_config = ${secretConfig ? this.sql.json(secretConfig) : null},
          credential_kind = ${credentialKind},
          credential_header_name = ${credentialHeaderName},
          health_status = CASE
            WHEN endpoint IS DISTINCT FROM ${endpoint ?? null}
              OR supported_networks IS DISTINCT FROM ${this.sql.json(networks)}
              OR supported_assets IS DISTINCT FROM ${this.sql.json(assets)}
            THEN 'unknown'
            ELSE health_status
          END,
          updated_at = NOW()
      WHERE id = ${providerId} AND is_system = FALSE AND owner_wallet = ${ownerWallet}
    `;
    const updated = await this.getProvider(providerId, ownerWallet);
    if (!updated) throw new Error("Provider was updated but could not be reloaded.");
    return updated;
  }

  async setStatus(
    providerId: string,
    ownerWallet: string,
    status: ProviderRegistryStatus,
  ): Promise<ProviderRegistryRecord> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE providers
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${providerId} AND is_system = FALSE AND owner_wallet = ${ownerWallet}
      RETURNING id
    `;
    if (rows.length === 0) {
      throw new ApplicationError("PROVIDER_NOT_FOUND", "Provider not found or is system-managed.", 404);
    }
    const updated = await this.getProvider(providerId, ownerWallet);
    if (!updated) throw new Error("Provider status changed but could not be reloaded.");
    return updated;
  }

  async recordHealth(
    providerId: string,
    ownerWallet: string,
    result: ProviderHealthResult,
  ): Promise<ProviderRegistryRecord> {
    const checked = result.checkedAtUnixSeconds;
    const rows = await this.sql<{ id: string }[]>`
      UPDATE providers
      SET health_status = ${result.status},
          last_health_check_at_unix = ${checked},
          last_success_at_unix = CASE WHEN ${result.status} = 'healthy' THEN ${checked} ELSE last_success_at_unix END,
          last_error_at_unix = CASE WHEN ${result.status} = 'unhealthy' THEN ${checked} ELSE NULL END,
          last_error_code = CASE WHEN ${result.status} = 'unhealthy' THEN ${result.code ?? "PROVIDER_HEALTH_FAILED"} ELSE NULL END,
          last_error_message = CASE WHEN ${result.status} = 'unhealthy' THEN ${result.message} ELSE NULL END,
          updated_at = NOW()
      WHERE id = ${providerId} AND (is_system = TRUE OR owner_wallet = ${ownerWallet})
      RETURNING id
    `;
    if (rows.length === 0) throw new ApplicationError("PROVIDER_NOT_FOUND", "Provider not found.", 404);
    const updated = await this.getProvider(providerId, ownerWallet);
    if (!updated) throw new Error("Provider health changed but could not be reloaded.");
    return updated;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
