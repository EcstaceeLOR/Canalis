import {
  ApplicationError,
  type JsonObject,
  type TransactionListQuery,
  type TransactionListResult,
  type TransactionRecord,
  type TransactionSummary,
} from "@canalis/application";
import postgres, { type Sql } from "postgres";

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function optional(value: unknown): string | undefined {
  return value === null || value === undefined || String(value) === "" ? undefined : String(value);
}

function mapRecord(row: Record<string, unknown>): TransactionRecord {
  return {
    id: String(row.id),
    kind: String(row.kind) as TransactionRecord["kind"],
    plane: String(row.plane) as TransactionRecord["plane"],
    status: String(row.status),
    taskId: String(row.task_id),
    taskName: String(row.task_name),
    providerId: String(row.provider_id),
    providerName: String(row.provider_name),
    protocol: String(row.protocol),
    ...(optional(row.network) ? { network: optional(row.network) } : {}),
    ...(optional(row.mint) ? { mint: optional(row.mint) } : {}),
    amountAtomic: String(row.amount_atomic ?? 0),
    ...(optional(row.previous_cumulative_atomic) ? { previousCumulativeAtomic: optional(row.previous_cumulative_atomic) } : {}),
    ...(optional(row.cumulative_atomic) ? { cumulativeAtomic: optional(row.cumulative_atomic) } : {}),
    ...(optional(row.request_id) ? { requestId: optional(row.request_id) } : {}),
    ...(optional(row.authorization_id) ? { authorizationId: optional(row.authorization_id) } : {}),
    ...(optional(row.payment_reference) ? { paymentReference: optional(row.payment_reference) } : {}),
    ...(optional(row.response_hash) ? { responseHash: optional(row.response_hash) } : {}),
    ...(optional(row.channel_address) ? { channelAddress: optional(row.channel_address) } : {}),
    ...(optional(row.signature) ? { signature: optional(row.signature) } : {}),
    timestampUnixSeconds: String(row.timestamp_unix_seconds),
    rawMetadata: jsonObject(row.raw_metadata),
  };
}

const auditCte = `
WITH audit_events AS (
  SELECT
    'authorization:' || f.id AS id,
    'authorization'::text AS kind,
    'offchain'::text AS plane,
    f.status::text AS status,
    t.id AS task_id,
    COALESCE(m.name, t.agent_id) AS task_name,
    f.provider_id,
    pr.name AS provider_name,
    r.protocol,
    c.network,
    r.mint,
    r.price_atomic AS amount_atomic,
    f.previous_cumulative_atomic,
    f.next_cumulative_atomic AS cumulative_atomic,
    f.request_id,
    r.authorization_id,
    r.payment_reference,
    r.response_hash,
    c.channel_address,
    NULL::text AS signature,
    r.timestamp_unix AS timestamp_unix_seconds,
    jsonb_build_object(
      'flowId', f.id,
      'flowStatus', f.status,
      'quotedAmountAtomic', f.quoted_amount_atomic::text,
      'protocolMetadata', COALESCE(r.protocol_metadata, '{}'::jsonb)
    ) AS raw_metadata
  FROM receipts r
  JOIN flows f ON f.id = r.flow_id
  JOIN tasks t ON t.id = r.task_id
  JOIN providers pr ON pr.id = r.provider_id
  LEFT JOIN channels c ON c.task_id = r.task_id AND c.provider_id = r.provider_id
  LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
  WHERE t.owner = $1

  UNION ALL

  SELECT
    CASE WHEN f.status = 'rejected' THEN 'rejection:' ELSE 'failure:' END || f.id AS id,
    CASE WHEN f.status = 'rejected' THEN 'rejection' ELSE 'failure' END::text AS kind,
    'offchain'::text AS plane,
    f.status::text AS status,
    t.id AS task_id,
    COALESCE(m.name, t.agent_id) AS task_name,
    f.provider_id,
    pr.name AS provider_name,
    pr.protocol,
    c.network,
    t.mint,
    GREATEST(f.next_cumulative_atomic - f.previous_cumulative_atomic, 0) AS amount_atomic,
    f.previous_cumulative_atomic,
    f.next_cumulative_atomic AS cumulative_atomic,
    f.request_id,
    f.authorization_id,
    f.payment_reference,
    NULL::text AS response_hash,
    c.channel_address,
    f.settlement_transaction_signature AS signature,
    f.created_at_unix AS timestamp_unix_seconds,
    jsonb_build_object(
      'flowId', f.id,
      'rejectionCode', f.rejection_code,
      'rejectionMessage', f.rejection_message,
      'errorMessage', f.error_message,
      'quotedAmountAtomic', f.quoted_amount_atomic::text
    ) AS raw_metadata
  FROM flows f
  JOIN tasks t ON t.id = f.task_id
  JOIN providers pr ON pr.id = f.provider_id
  LEFT JOIN channels c ON c.task_id = f.task_id AND c.provider_id = f.provider_id
  LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
  WHERE t.owner = $1 AND f.status IN ('rejected', 'failed')

  UNION ALL

  SELECT
    'channel_open:' || c.task_id || ':' || c.provider_id AS id,
    'channel_open'::text AS kind,
    'onchain'::text AS plane,
    CASE WHEN c.open_transaction_signature IS NULL THEN 'missing' ELSE 'confirmed' END::text AS status,
    t.id AS task_id,
    COALESCE(m.name, t.agent_id) AS task_name,
    c.provider_id,
    pr.name AS provider_name,
    pr.protocol,
    c.network,
    t.mint,
    c.ceiling_atomic AS amount_atomic,
    0::numeric AS previous_cumulative_atomic,
    c.cumulative_authorized_atomic AS cumulative_atomic,
    NULL::text AS request_id,
    NULL::text AS authorization_id,
    NULL::text AS payment_reference,
    NULL::text AS response_hash,
    c.channel_address,
    c.open_transaction_signature AS signature,
    c.created_at_unix AS timestamp_unix_seconds,
    jsonb_build_object(
      'programAddress', c.program_address,
      'channelStatus', c.status,
      'ceilingAtomic', c.ceiling_atomic::text
    ) AS raw_metadata
  FROM channels c
  JOIN tasks t ON t.id = c.task_id
  JOIN providers pr ON pr.id = c.provider_id
  LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
  WHERE t.owner = $1 AND c.open_transaction_signature IS NOT NULL

  UNION ALL

  SELECT
    'settlement:' || c.task_id || ':' || c.provider_id AS id,
    'settlement'::text AS kind,
    'onchain'::text AS plane,
    CASE WHEN c.settle_transaction_signature IS NULL THEN c.status ELSE 'confirmed' END::text AS status,
    t.id AS task_id,
    COALESCE(m.name, t.agent_id) AS task_name,
    c.provider_id,
    pr.name AS provider_name,
    pr.protocol,
    c.network,
    t.mint,
    c.cumulative_authorized_atomic AS amount_atomic,
    0::numeric AS previous_cumulative_atomic,
    c.cumulative_authorized_atomic AS cumulative_atomic,
    NULL::text AS request_id,
    NULL::text AS authorization_id,
    NULL::text AS payment_reference,
    NULL::text AS response_hash,
    c.channel_address,
    c.settle_transaction_signature AS signature,
    c.updated_at_unix AS timestamp_unix_seconds,
    jsonb_build_object('channelStatus', c.status, 'spentAtomic', c.spent_atomic::text) AS raw_metadata
  FROM channels c
  JOIN tasks t ON t.id = c.task_id
  JOIN providers pr ON pr.id = c.provider_id
  LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
  WHERE t.owner = $1 AND c.settle_transaction_signature IS NOT NULL

  UNION ALL

  SELECT
    'distribution:' || c.task_id || ':' || c.provider_id AS id,
    'distribution'::text AS kind,
    'onchain'::text AS plane,
    CASE WHEN c.distribution_transaction_signature IS NULL THEN c.status ELSE 'confirmed' END::text AS status,
    t.id AS task_id,
    COALESCE(m.name, t.agent_id) AS task_name,
    c.provider_id,
    pr.name AS provider_name,
    pr.protocol,
    c.network,
    t.mint,
    c.spent_atomic AS amount_atomic,
    0::numeric AS previous_cumulative_atomic,
    c.cumulative_authorized_atomic AS cumulative_atomic,
    NULL::text AS request_id,
    NULL::text AS authorization_id,
    NULL::text AS payment_reference,
    NULL::text AS response_hash,
    c.channel_address,
    c.distribution_transaction_signature AS signature,
    c.updated_at_unix AS timestamp_unix_seconds,
    jsonb_build_object('channelStatus', c.status, 'spentAtomic', c.spent_atomic::text) AS raw_metadata
  FROM channels c
  JOIN tasks t ON t.id = c.task_id
  JOIN providers pr ON pr.id = c.provider_id
  LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
  WHERE t.owner = $1 AND c.distribution_transaction_signature IS NOT NULL

  UNION ALL

  SELECT
    'recovery:' || c.task_id || ':' || c.provider_id AS id,
    'recovery'::text AS kind,
    'onchain'::text AS plane,
    CASE WHEN c.refund_transaction_signature IS NULL THEN c.status ELSE 'confirmed' END::text AS status,
    t.id AS task_id,
    COALESCE(m.name, t.agent_id) AS task_name,
    c.provider_id,
    pr.name AS provider_name,
    pr.protocol,
    c.network,
    t.mint,
    GREATEST(c.ceiling_atomic - c.spent_atomic, 0) AS amount_atomic,
    c.spent_atomic AS previous_cumulative_atomic,
    c.ceiling_atomic AS cumulative_atomic,
    NULL::text AS request_id,
    NULL::text AS authorization_id,
    NULL::text AS payment_reference,
    NULL::text AS response_hash,
    c.channel_address,
    c.refund_transaction_signature AS signature,
    c.updated_at_unix AS timestamp_unix_seconds,
    jsonb_build_object(
      'channelStatus', c.status,
      'ceilingAtomic', c.ceiling_atomic::text,
      'spentAtomic', c.spent_atomic::text,
      'recoveryState', COALESCE(c.recovery_state, '{}'::jsonb)
    ) AS raw_metadata
  FROM channels c
  JOIN tasks t ON t.id = c.task_id
  JOIN providers pr ON pr.id = c.provider_id
  LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
  WHERE t.owner = $1 AND c.refund_transaction_signature IS NOT NULL

  UNION ALL

  SELECT
    'settlement-record:' || s.task_id || ':' || s.provider_id || ':' || s.transaction_signature AS id,
    'settlement'::text AS kind,
    'onchain'::text AS plane,
    'confirmed'::text AS status,
    t.id AS task_id,
    COALESCE(m.name, t.agent_id) AS task_name,
    s.provider_id,
    pr.name AS provider_name,
    pr.protocol,
    c.network,
    t.mint,
    s.cumulative_amount_atomic AS amount_atomic,
    0::numeric AS previous_cumulative_atomic,
    s.cumulative_amount_atomic AS cumulative_atomic,
    NULL::text AS request_id,
    NULL::text AS authorization_id,
    NULL::text AS payment_reference,
    NULL::text AS response_hash,
    c.channel_address,
    s.transaction_signature AS signature,
    FLOOR(EXTRACT(EPOCH FROM s.created_at))::bigint AS timestamp_unix_seconds,
    jsonb_build_object('source', 'settlements') AS raw_metadata
  FROM settlements s
  JOIN tasks t ON t.id = s.task_id
  JOIN providers pr ON pr.id = s.provider_id
  LEFT JOIN channels c ON c.task_id = s.task_id AND c.provider_id = s.provider_id
  LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
  WHERE t.owner = $1
    AND NOT EXISTS (
      SELECT 1 FROM channels cx
      WHERE cx.task_id = s.task_id
        AND cx.provider_id = s.provider_id
        AND cx.settle_transaction_signature = s.transaction_signature
    )
)
`;

export class PostgresTransactionRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 5, prepare: false });
  }

  private filters(query: TransactionListQuery) {
    const params: Array<string | number> = [query.owner];
    const clauses: string[] = [];
    const add = (value: string | number) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (query.search) {
      const p = add(`%${query.search}%`);
      clauses.push(`(task_id ILIKE ${p} OR task_name ILIKE ${p} OR provider_id ILIKE ${p} OR provider_name ILIKE ${p} OR COALESCE(response_hash, '') ILIKE ${p} OR COALESCE(signature, '') ILIKE ${p} OR COALESCE(channel_address, '') ILIKE ${p} OR COALESCE(request_id, '') ILIKE ${p} OR COALESCE(authorization_id, '') ILIKE ${p})`);
    }
    if (query.taskId) clauses.push(`task_id = ${add(query.taskId)}`);
    if (query.providerId) clauses.push(`provider_id = ${add(query.providerId)}`);
    if (query.protocol) clauses.push(`protocol = ${add(query.protocol)}`);
    if (query.network) clauses.push(`COALESCE(network, '') = ${add(query.network)}`);
    if (query.statuses?.length) {
      const values = query.statuses.map((status) => add(status));
      clauses.push(`status IN (${values.join(", ")})`);
    }
    if (query.kinds?.length) {
      const values = query.kinds.map((kind) => add(kind));
      clauses.push(`kind IN (${values.join(", ")})`);
    }
    if (query.fromUnixSeconds !== undefined) clauses.push(`timestamp_unix_seconds >= ${add(query.fromUnixSeconds.toString())}::bigint`);
    if (query.toUnixSeconds !== undefined) clauses.push(`timestamp_unix_seconds <= ${add(query.toUnixSeconds.toString())}::bigint`);

    return { params, where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "" };
  }

  async list(query: TransactionListQuery): Promise<TransactionListResult> {
    const { params, where } = this.filters(query);
    const countRows = await this.sql.unsafe<Record<string, unknown>[]>(
      `${auditCte} SELECT COUNT(*)::int AS total FROM audit_events ${where}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? 0);

    const summaryRows = await this.sql.unsafe<Record<string, unknown>[]>(
      `${auditCte}
       SELECT
         COUNT(*) FILTER (WHERE kind = 'authorization')::int AS authorization_count,
         COALESCE(SUM(amount_atomic) FILTER (WHERE kind = 'authorization'), 0) AS authorization_atomic,
         COALESCE(SUM(amount_atomic) FILTER (WHERE kind = 'settlement'), 0) AS settled_atomic,
         COALESCE(SUM(amount_atomic) FILTER (WHERE kind = 'recovery'), 0) AS recovered_atomic,
         COUNT(*) FILTER (WHERE kind IN ('failure', 'rejection'))::int AS failed_count,
         COUNT(*) FILTER (WHERE plane = 'onchain')::int AS onchain_count
       FROM audit_events ${where}`,
      params,
    );
    const summaryRow = summaryRows[0] ?? {};
    const summary: TransactionSummary = {
      authorizationCount: Number(summaryRow.authorization_count ?? 0),
      authorizationAtomic: String(summaryRow.authorization_atomic ?? 0),
      settledAtomic: String(summaryRow.settled_atomic ?? 0),
      recoveredAtomic: String(summaryRow.recovered_atomic ?? 0),
      failedCount: Number(summaryRow.failed_count ?? 0),
      onchainCount: Number(summaryRow.onchain_count ?? 0),
    };

    const offset = (query.page - 1) * query.pageSize;
    const pagedParams: Array<string | number> = [...params, query.pageSize, offset];
    const limit = `$${pagedParams.length - 1}`;
    const skip = `$${pagedParams.length}`;
    const order = query.sort === "oldest"
      ? "timestamp_unix_seconds ASC, id ASC"
      : query.sort === "amount_desc"
        ? "amount_atomic DESC, timestamp_unix_seconds DESC"
        : "timestamp_unix_seconds DESC, id DESC";
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `${auditCte} SELECT * FROM audit_events ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${skip}`,
      pagedParams,
    );

    return {
      records: rows.map(mapRecord),
      summary,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async getById(id: string, owner: string): Promise<TransactionRecord | null> {
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `${auditCte} SELECT * FROM audit_events WHERE id = $2 LIMIT 1`,
      [owner, id],
    );
    return rows[0] ? mapRecord(rows[0]) : null;
  }

  async exportAll(query: TransactionListQuery): Promise<{ records: TransactionRecord[]; summary: TransactionSummary }> {
    const normalized = { ...query, page: 1, pageSize: 100 };
    const first = await this.list(normalized);
    if (first.total > 10_000) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Export is limited to 10,000 matching records. Narrow the filters and try again.",
        400,
      );
    }
    if (first.total <= first.records.length) return { records: first.records, summary: first.summary };

    const { params, where } = this.filters(query);
    const order = query.sort === "oldest"
      ? "timestamp_unix_seconds ASC, id ASC"
      : query.sort === "amount_desc"
        ? "amount_atomic DESC, timestamp_unix_seconds DESC"
        : "timestamp_unix_seconds DESC, id DESC";
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `${auditCte} SELECT * FROM audit_events ${where} ORDER BY ${order} LIMIT 10000`,
      params,
    );
    return { records: rows.map(mapRecord), summary: first.summary };
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
