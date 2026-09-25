import {
  ApplicationError,
  parseUsdc,
  policyId,
  type PolicyRecord,
  type PolicyVersionRecord,
  type ReusablePolicyRules,
} from "@canalis/application";
import postgres, { type Sql, type TransactionSql } from "postgres";

function unix(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return String(Math.floor(date.getTime() / 1000));
}

function array(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function atomicToUsd(value: unknown): string {
  const atomic = BigInt(String(value));
  const whole = atomic / 1_000_000n;
  const fraction = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function capsToUsd(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, atomic]) => [key, atomicToUsd(atomic)]),
  );
}

function rulesFromRow(row: Record<string, unknown>): ReusablePolicyRules {
  return {
    totalCeilingUsd: atomicToUsd(row.total_ceiling_atomic),
    maxPerCallUsd: atomicToUsd(row.max_per_call_atomic),
    allowedProviders: array(row.allowed_provider_ids),
    blockedProviders: array(row.blocked_provider_ids),
    providerCapsUsd: capsToUsd(row.provider_caps_atomic),
    durationMinutes: Number(row.duration_minutes),
    allowedNetworks: array(row.allowed_networks),
    allowedMints: array(row.allowed_mints),
    allowedProtocols: array(row.allowed_protocols) as ReusablePolicyRules["allowedProtocols"],
  };
}

function versionFromRow(row: Record<string, unknown>): PolicyVersionRecord {
  return {
    policyId: String(row.policy_id),
    version: Number(row.version),
    rules: rulesFromRow(row),
    createdAtUnixSeconds: unix(row.version_created_at ?? row.created_at),
  };
}

function policyFromRow(row: Record<string, unknown>): PolicyRecord {
  return {
    id: String(row.id),
    ownerWallet: String(row.owner_wallet),
    name: String(row.name),
    description: String(row.description ?? ""),
    status: String(row.status) as PolicyRecord["status"],
    latestVersion: Number(row.latest_version),
    latest: versionFromRow({ ...row, policy_id: row.id, version: row.latest_version }),
    usageCount: Number(row.usage_count ?? 0),
    createdAtUnixSeconds: unix(row.definition_created_at ?? row.created_at),
    updatedAtUnixSeconds: unix(row.updated_at),
  };
}

function atomicCaps(rules: ReusablePolicyRules): Record<string, string> {
  return Object.fromEntries(
    Object.entries(rules.providerCapsUsd).map(([providerId, usd]) => [providerId, parseUsdc(usd).toString()]),
  );
}

export class PostgresPolicyRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 5, prepare: false });
  }

  private versionInsert(tx: TransactionSql, id: string, version: number, rules: ReusablePolicyRules) {
    return tx`
      INSERT INTO reusable_policy_versions (
        policy_id, version, total_ceiling_atomic, max_per_call_atomic,
        allowed_provider_ids, blocked_provider_ids, provider_caps_atomic,
        duration_minutes, allowed_networks, allowed_mints, allowed_protocols
      ) VALUES (
        ${id}, ${version}, ${parseUsdc(rules.totalCeilingUsd).toString()},
        ${parseUsdc(rules.maxPerCallUsd).toString()}, ${tx.json(rules.allowedProviders)},
        ${tx.json(rules.blockedProviders)}, ${tx.json(atomicCaps(rules))},
        ${rules.durationMinutes}, ${tx.json(rules.allowedNetworks)},
        ${tx.json(rules.allowedMints)}, ${tx.json(rules.allowedProtocols)}
      )
    `;
  }

  async list(ownerWallet: string, includeArchived = false): Promise<PolicyRecord[]> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT d.id, d.owner_wallet, d.name, d.description, d.status, d.latest_version,
             d.created_at AS definition_created_at, d.updated_at,
             v.total_ceiling_atomic, v.max_per_call_atomic, v.allowed_provider_ids,
             v.blocked_provider_ids, v.provider_caps_atomic, v.duration_minutes,
             v.allowed_networks, v.allowed_mints, v.allowed_protocols,
             v.created_at AS version_created_at,
             (SELECT COUNT(*)::int FROM policies p WHERE p.policy_definition_id = d.id) AS usage_count
      FROM reusable_policy_definitions d
      JOIN reusable_policy_versions v ON v.policy_id = d.id AND v.version = d.latest_version
      WHERE d.owner_wallet = ${ownerWallet}
        AND (${includeArchived} OR d.status = 'active')
      ORDER BY d.status ASC, d.updated_at DESC, LOWER(d.name) ASC
    `;
    return rows.map(policyFromRow);
  }

  async get(policyIdValue: string, ownerWallet: string, version?: number): Promise<PolicyRecord | null> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT d.id, d.owner_wallet, d.name, d.description, d.status, d.latest_version,
             d.created_at AS definition_created_at, d.updated_at,
             v.version, v.total_ceiling_atomic, v.max_per_call_atomic, v.allowed_provider_ids,
             v.blocked_provider_ids, v.provider_caps_atomic, v.duration_minutes,
             v.allowed_networks, v.allowed_mints, v.allowed_protocols,
             v.created_at AS version_created_at,
             (SELECT COUNT(*)::int FROM policies p WHERE p.policy_definition_id = d.id) AS usage_count
      FROM reusable_policy_definitions d
      JOIN reusable_policy_versions v ON v.policy_id = d.id
      WHERE d.id = ${policyIdValue} AND d.owner_wallet = ${ownerWallet}
        AND v.version = COALESCE(${version ?? null}, d.latest_version)
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    const record = policyFromRow(row);
    record.latest = versionFromRow({ ...row, policy_id: row.id });
    return record;
  }

  async listVersions(policyIdValue: string, ownerWallet: string): Promise<PolicyVersionRecord[]> {
    const owner = await this.sql<{ id: string }[]>`
      SELECT id FROM reusable_policy_definitions
      WHERE id = ${policyIdValue} AND owner_wallet = ${ownerWallet}
    `;
    if (!owner.length) throw new ApplicationError("POLICY_NOT_FOUND", "Policy not found.", 404);
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT policy_id, version, total_ceiling_atomic, max_per_call_atomic,
             allowed_provider_ids, blocked_provider_ids, provider_caps_atomic,
             duration_minutes, allowed_networks, allowed_mints, allowed_protocols,
             created_at AS version_created_at
      FROM reusable_policy_versions
      WHERE policy_id = ${policyIdValue}
      ORDER BY version DESC
    `;
    return rows.map(versionFromRow);
  }

  async create(ownerWallet: string, name: string, description: string, rules: ReusablePolicyRules): Promise<PolicyRecord> {
    const id = policyId();
    await this.sql.begin(async (tx) => {
      await tx`
        INSERT INTO reusable_policy_definitions (id, owner_wallet, name, description, status, latest_version)
        VALUES (${id}, ${ownerWallet}, ${name}, ${description}, 'active', 1)
      `;
      await this.versionInsert(tx, id, 1, rules);
    });
    const created = await this.get(id, ownerWallet);
    if (!created) throw new Error("Policy created but could not be reloaded.");
    return created;
  }

  async update(
    policyIdValue: string,
    ownerWallet: string,
    input: { name?: string; description?: string; rules?: ReusablePolicyRules },
  ): Promise<PolicyRecord> {
    await this.sql.begin(async (tx) => {
      const definitions = await tx<Record<string, unknown>[]>`
        SELECT * FROM reusable_policy_definitions
        WHERE id = ${policyIdValue} AND owner_wallet = ${ownerWallet}
        FOR UPDATE
      `;
      const current = definitions[0];
      if (!current) throw new ApplicationError("POLICY_NOT_FOUND", "Policy not found.", 404);
      if (current.status === "archived") {
        throw new ApplicationError("POLICY_ARCHIVED", "Archived policies cannot be edited. Duplicate it to create an active policy.", 409);
      }
      let nextVersion = Number(current.latest_version);
      if (input.rules) {
        nextVersion += 1;
        await this.versionInsert(tx, policyIdValue, nextVersion, input.rules);
      }
      await tx`
        UPDATE reusable_policy_definitions
        SET name = ${input.name ?? String(current.name)},
            description = ${input.description ?? String(current.description ?? "")},
            latest_version = ${nextVersion},
            updated_at = NOW()
        WHERE id = ${policyIdValue}
      `;
    });
    const updated = await this.get(policyIdValue, ownerWallet);
    if (!updated) throw new Error("Policy updated but could not be reloaded.");
    return updated;
  }

  async duplicate(policyIdValue: string, ownerWallet: string): Promise<PolicyRecord> {
    const source = await this.get(policyIdValue, ownerWallet);
    if (!source) throw new ApplicationError("POLICY_NOT_FOUND", "Policy not found.", 404);
    return this.create(ownerWallet, `${source.name} · copy`.slice(0, 120), source.description, source.latest.rules);
  }

  async archive(policyIdValue: string, ownerWallet: string): Promise<PolicyRecord> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE reusable_policy_definitions
      SET status = 'archived', updated_at = NOW()
      WHERE id = ${policyIdValue} AND owner_wallet = ${ownerWallet} AND status <> 'archived'
      RETURNING id
    `;
    if (!rows.length) {
      const existing = await this.get(policyIdValue, ownerWallet);
      if (!existing) throw new ApplicationError("POLICY_NOT_FOUND", "Policy not found.", 404);
      return existing;
    }
    const archived = await this.get(policyIdValue, ownerWallet);
    if (!archived) throw new Error("Policy archived but could not be reloaded.");
    return archived;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
