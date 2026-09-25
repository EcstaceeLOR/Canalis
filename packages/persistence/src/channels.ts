import type {
  ChannelListQuery,
  ChannelListResult,
  ChannelWorkspaceFilter,
  ChannelWorkspaceSummary,
} from "@canalis/application";
import postgres, { type Sql } from "postgres";

const terminalStatuses = new Set(["distributed", "recovered"]);

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optional(value: unknown): string | undefined {
  return value === null || value === undefined || String(value) === "" ? undefined : String(value);
}

function operationalStatus(row: Record<string, unknown>, now: bigint): Exclude<ChannelWorkspaceFilter, "all"> {
  const status = String(row.status);
  const expiry = BigInt(String(row.expires_at_unix));
  const recovery = jsonObject(row.recovery_state);
  const stage = String(recovery.stage ?? "");
  const blocked = recovery.automaticRetryBlocked === true;
  if (status === "failed" || blocked || ["finalization-started", "finalization-ambiguous"].includes(stage)) return "failed";
  if (!terminalStatuses.has(status) && expiry <= now) return "expired";
  if (status === "distributed") return "settled";
  if (status === "recovered") return "recovered";
  if (status === "sealed") return "sealed";
  if (status === "reserved") return "reserved";
  if (status === "open") {
    const ceiling = BigInt(String(row.ceiling_atomic));
    const authorized = BigInt(String(row.cumulative_authorized_atomic));
    const taskStatus = String(row.task_status);
    if (ceiling > authorized && ["completed", "cancelled", "archived"].includes(taskStatus)) return "recoverable";
    return "active";
  }
  return "active";
}

function mapSummary(row: Record<string, unknown>, now: bigint): ChannelWorkspaceSummary {
  const ceiling = BigInt(String(row.ceiling_atomic));
  const authorized = BigInt(String(row.cumulative_authorized_atomic));
  const spent = BigInt(String(row.spent_atomic));
  const terminal = terminalStatuses.has(String(row.status));
  const recovery = jsonObject(row.recovery_state);
  const recoveryStage = optional(recovery.stage);
  const blocked = recovery.automaticRetryBlocked === true;
  const op = operationalStatus(row, now);
  const taskStatus = String(row.task_status);
  const expiry = BigInt(String(row.expires_at_unix));
  const finalizable = String(row.status) === "open" && (["completed", "cancelled", "archived"].includes(taskStatus) || expiry <= now);
  const nextAction = op === "failed"
    ? "inspect"
    : finalizable
      ? authorized === 0n ? "recover" : "finalize"
      : null;

  return {
    id: `${String(row.task_id)}:${String(row.provider_id)}`,
    taskId: String(row.task_id),
    taskName: String(row.task_name ?? row.agent_id),
    providerId: String(row.provider_id),
    providerName: String(row.provider_name ?? row.provider_id),
    providerPayee: String(row.provider_payee ?? ""),
    payer: String(row.owner),
    mint: String(row.mint),
    network: String(row.network),
    programAddress: String(row.program_address),
    ...(optional(row.channel_address) ? { channelAddress: optional(row.channel_address) } : {}),
    status: String(row.status),
    operationalStatus: op,
    ceilingAtomic: ceiling.toString(),
    cumulativeAuthorizedAtomic: authorized.toString(),
    spentAtomic: spent.toString(),
    remainingEscrowAtomic: (terminal ? 0n : ceiling - authorized).toString(),
    recoverableAtomic: (ceiling - authorized > 0n ? ceiling - authorized : 0n).toString(),
    createdAtUnixSeconds: String(row.created_at_unix),
    expiresAtUnixSeconds: String(row.expires_at_unix),
    updatedAtUnixSeconds: String(row.updated_at_unix),
    ...(recoveryStage ? { recoveryStage } : {}),
    recoveryRequired: op === "failed",
    automaticRetryBlocked: blocked,
    nextAction,
    ...(optional(row.open_transaction_signature) ? { openTransactionSignature: optional(row.open_transaction_signature) } : {}),
    ...(optional(row.settle_transaction_signature) ? { settleTransactionSignature: optional(row.settle_transaction_signature) } : {}),
    ...(optional(row.distribution_transaction_signature) ? { distributionTransactionSignature: optional(row.distribution_transaction_signature) } : {}),
    ...(optional(row.refund_transaction_signature) ? { refundTransactionSignature: optional(row.refund_transaction_signature) } : {}),
  };
}

const baseSelect = `
  SELECT c.*, t.owner, t.agent_id, t.mint, t.status AS task_status,
         t.expires_at_unix,
         COALESCE(m.name, t.agent_id) AS task_name,
         COALESCE(p.name, c.provider_id) AS provider_name,
         COALESCE(p.payee, '') AS provider_payee
  FROM channels c
  JOIN tasks t ON t.id = c.task_id
  LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
  LEFT JOIN providers p ON p.id = c.provider_id
`;

export class PostgresChannelWorkspaceRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 5, prepare: false });
  }

  async listChannels(query: ChannelListQuery, nowUnixSeconds = BigInt(Math.floor(Date.now() / 1000))): Promise<ChannelListResult> {
    const params: Array<string | number> = [query.owner];
    const clauses = ["t.owner = $1"];
    const add = (value: string | number) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (query.search) {
      const value = add(`%${query.search}%`);
      clauses.push(`(c.channel_address ILIKE ${value} OR c.task_id ILIKE ${value} OR c.provider_id ILIKE ${value} OR COALESCE(m.name, t.agent_id) ILIKE ${value} OR COALESCE(p.name, c.provider_id) ILIKE ${value})`);
    }
    if (query.providerId) clauses.push(`c.provider_id = ${add(query.providerId)}`);

    const status = query.status;
    if (status === "active") clauses.push(`c.status = 'open' AND t.expires_at_unix > ${add(nowUnixSeconds.toString())} AND COALESCE(c.recovery_state->>'stage', '') NOT IN ('finalization-started', 'finalization-ambiguous')`);
    else if (status === "reserved") clauses.push("c.status = 'reserved'");
    else if (status === "sealed") clauses.push("c.status = 'sealed'");
    else if (status === "settled") clauses.push("c.status = 'distributed'");
    else if (status === "recovered") clauses.push("c.status = 'recovered'");
    else if (status === "failed") clauses.push(`(c.status = 'failed' OR COALESCE(c.recovery_state->>'stage', '') IN ('finalization-started', 'finalization-ambiguous') OR COALESCE((c.recovery_state->>'automaticRetryBlocked')::boolean, false))`);
    else if (status === "expired") clauses.push(`c.status NOT IN ('distributed', 'recovered') AND t.expires_at_unix <= ${add(nowUnixSeconds.toString())}`);
    else if (status === "recoverable") clauses.push(`c.status = 'open' AND c.ceiling_atomic > c.cumulative_authorized_atomic AND (t.status IN ('completed', 'cancelled', 'archived') OR t.expires_at_unix <= ${add(nowUnixSeconds.toString())})`);

    const where = clauses.join(" AND ");
    const countRows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT COUNT(*)::int AS total FROM channels c JOIN tasks t ON t.id = c.task_id LEFT JOIN task_workspace_metadata m ON m.task_id=t.id LEFT JOIN providers p ON p.id=c.provider_id WHERE ${where}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const offset = (query.page - 1) * query.pageSize;
    const selectParams = [...params, query.pageSize, offset];
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `${baseSelect} WHERE ${where} ORDER BY c.updated_at_unix DESC, c.task_id ASC, c.provider_id ASC LIMIT $${selectParams.length - 1} OFFSET $${selectParams.length}`,
      selectParams,
    );

    const allRows = await this.sql.unsafe<Record<string, unknown>[]>(
      `${baseSelect} WHERE t.owner = $1`,
      [query.owner],
    );
    const counts: ChannelListResult["counts"] = {
      active: 0,
      reserved: 0,
      sealed: 0,
      settled: 0,
      recovered: 0,
      recoverable: 0,
      expired: 0,
      failed: 0,
    };
    for (const row of allRows) counts[operationalStatus(row, nowUnixSeconds)] += 1;

    return {
      channels: rows.map((row) => mapSummary(row, nowUnixSeconds)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      counts,
    };
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
