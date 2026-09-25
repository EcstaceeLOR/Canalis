import type {
  JsonObject,
  TransactionExplorerQuery,
  TransactionExplorerRecord,
  TransactionExplorerResult,
  TransactionExplorerSummary,
} from "@canalis/application";
import postgres, { type Sql } from "postgres";

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function optional(value: unknown): string | undefined {
  return value === null || value === undefined || String(value) === "" ? undefined : String(value);
}

function mapRecord(row: Record<string, unknown>): TransactionExplorerRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    taskName: String(row.task_name ?? row.task_id),
    providerId: String(row.provider_id),
    providerName: String(row.provider_name ?? row.provider_id),
    eventType: String(row.event_type) as TransactionExplorerRecord["eventType"],
    layer: String(row.layer) as TransactionExplorerRecord["layer"],
    status: String(row.status),
    protocol: String(row.protocol),
    network: String(row.network),
    mint: String(row.mint),
    amountAtomic: String(row.amount_atomic ?? 0),
    ...(optional(row.cumulative_atomic) ? { cumulativeAtomic: optional(row.cumulative_atomic) } : {}),
    authorizedDeltaAtomic: String(row.authorized_delta_atomic ?? 0),
    settledDeltaAtomic: String(row.settled_delta_atomic ?? 0),
    recoveredAtomic: String(row.recovered_atomic ?? 0),
    ...(optional(row.channel_address) ? { channelAddress: optional(row.channel_address) } : {}),
    ...(optional(row.receipt_hash) ? { receiptHash: optional(row.receipt_hash) } : {}),
    ...(optional(row.signature) ? { signature: optional(row.signature) } : {}),
    ...(optional(row.request_id) ? { requestId: optional(row.request_id) } : {}),
    ...(optional(row.authorization_id) ? { authorizationId: optional(row.authorization_id) } : {}),
    ...(optional(row.payment_reference) ? { paymentReference: optional(row.payment_reference) } : {}),
    ...(optional(row.source_flow_id) ? { sourceFlowId: optional(row.source_flow_id) } : {}),
    metadata: objectValue(row.metadata),
    createdAtUnixSeconds: String(row.created_at_unix),
  };
}

const baseSelect = `
  SELECT e.*, t.owner,
         COALESCE(m.name, t.agent_id) AS task_name,
         COALESCE(p.name, e.provider_id) AS provider_name
  FROM transaction_events e
  JOIN tasks t ON t.id = e.task_id
  LEFT JOIN task_workspace_metadata m ON m.task_id = e.task_id
  LEFT JOIN providers p ON p.id = e.provider_id
`;

function buildWhere(query: TransactionExplorerQuery) {
  const params: Array<string | number> = [query.owner];
  const clauses = ["t.owner = $1"];
  const add = (value: string | number) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (query.search) {
    const term = add(`%${query.search}%`);
    clauses.push(`(
      e.id ILIKE ${term}
      OR e.task_id ILIKE ${term}
      OR e.provider_id ILIKE ${term}
      OR COALESCE(m.name, t.agent_id) ILIKE ${term}
      OR COALESCE(p.name, e.provider_id) ILIKE ${term}
      OR COALESCE(e.channel_address, '') ILIKE ${term}
      OR COALESCE(e.receipt_hash, '') ILIKE ${term}
      OR COALESCE(e.signature, '') ILIKE ${term}
      OR COALESCE(e.authorization_id, '') ILIKE ${term}
      OR COALESCE(e.payment_reference, '') ILIKE ${term}
      OR COALESCE(e.request_id, '') ILIKE ${term}
    )`);
  }
  if (query.taskId) clauses.push(`e.task_id = ${add(query.taskId)}`);
  if (query.providerId) clauses.push(`e.provider_id = ${add(query.providerId)}`);
  if (query.protocol) clauses.push(`e.protocol = ${add(query.protocol)}`);
  if (query.status) clauses.push(`e.status = ${add(query.status)}`);
  if (query.network) clauses.push(`e.network = ${add(query.network)}`);
  if (query.eventType) clauses.push(`e.event_type = ${add(query.eventType)}`);
  if (query.layer) clauses.push(`e.layer = ${add(query.layer)}`);
  if (query.createdFromUnixSeconds !== undefined) {
    clauses.push(`e.created_at_unix >= ${add(query.createdFromUnixSeconds.toString())}`);
  }
  if (query.createdToUnixSeconds !== undefined) {
    clauses.push(`e.created_at_unix <= ${add(query.createdToUnixSeconds.toString())}`);
  }

  return { where: clauses.join(" AND "), params };
}

function sortSql(sort: TransactionExplorerQuery["sort"]) {
  if (sort === "oldest") return "e.created_at_unix ASC, e.id ASC";
  if (sort === "amount_desc") return "e.amount_atomic DESC, e.created_at_unix DESC, e.id DESC";
  if (sort === "amount_asc") return "e.amount_atomic ASC, e.created_at_unix DESC, e.id DESC";
  return "e.created_at_unix DESC, e.id DESC";
}

function mapSummary(row: Record<string, unknown> | undefined): TransactionExplorerSummary {
  return {
    totalEvents: Number(row?.total_events ?? 0),
    offchainEvents: Number(row?.offchain_events ?? 0),
    onchainEvents: Number(row?.onchain_events ?? 0),
    failedEvents: Number(row?.failed_events ?? 0),
    authorizedAtomic: String(row?.authorized_atomic ?? 0),
    settledAtomic: String(row?.settled_atomic ?? 0),
    recoveredAtomic: String(row?.recovered_atomic ?? 0),
  };
}

export class PostgresTransactionExplorerRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 5, prepare: false });
  }

  async listEvents(query: TransactionExplorerQuery): Promise<TransactionExplorerResult> {
    const { where, params } = buildWhere(query);
    const summaryRows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT
         COUNT(*)::int AS total_events,
         COUNT(*) FILTER (WHERE e.layer = 'offchain')::int AS offchain_events,
         COUNT(*) FILTER (WHERE e.layer = 'onchain')::int AS onchain_events,
         COUNT(*) FILTER (WHERE e.status = 'failed' OR e.event_type = 'failure')::int AS failed_events,
         COALESCE(SUM(e.authorized_delta_atomic), 0)::text AS authorized_atomic,
         COALESCE(SUM(e.settled_delta_atomic), 0)::text AS settled_atomic,
         COALESCE(SUM(e.recovered_atomic), 0)::text AS recovered_atomic
       FROM transaction_events e
       JOIN tasks t ON t.id = e.task_id
       LEFT JOIN task_workspace_metadata m ON m.task_id = e.task_id
       LEFT JOIN providers p ON p.id = e.provider_id
       WHERE ${where}`,
      params,
    );
    const summary = mapSummary(summaryRows[0]);
    const offset = (query.page - 1) * query.pageSize;
    const pageParams = [...params, query.pageSize, offset];
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `${baseSelect}
       WHERE ${where}
       ORDER BY ${sortSql(query.sort)}
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    );

    return {
      events: rows.map(mapRecord),
      total: summary.totalEvents,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(summary.totalEvents / query.pageSize)),
      summary,
    };
  }

  async getEvent(eventId: string, owner: string): Promise<TransactionExplorerRecord | null> {
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `${baseSelect} WHERE e.id = $1 AND t.owner = $2 LIMIT 1`,
      [eventId, owner],
    );
    return rows[0] ? mapRecord(rows[0]) : null;
  }

  async listRelatedEvents(
    taskId: string,
    providerId: string,
    owner: string,
    limit = 30,
  ): Promise<TransactionExplorerRecord[]> {
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `${baseSelect}
       WHERE e.task_id = $1 AND e.provider_id = $2 AND t.owner = $3
       ORDER BY e.created_at_unix ASC, e.id ASC
       LIMIT $4`,
      [taskId, providerId, owner, Math.max(1, Math.min(limit, 100))],
    );
    return rows.map(mapRecord);
  }

  async exportEvents(
    query: TransactionExplorerQuery,
    limit = 10_000,
  ): Promise<{ events: TransactionExplorerRecord[]; summary: TransactionExplorerSummary; truncated: boolean }> {
    const { where, params } = buildWhere(query);
    const cappedLimit = Math.max(1, Math.min(limit, 10_000));
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `${baseSelect}
       WHERE ${where}
       ORDER BY ${sortSql(query.sort)}
       LIMIT $${params.length + 1}`,
      [...params, cappedLimit + 1],
    );
    const truncated = rows.length > cappedLimit;
    const events = rows.slice(0, cappedLimit).map(mapRecord);
    const summary = events.reduce<TransactionExplorerSummary>(
      (acc, event) => ({
        totalEvents: acc.totalEvents + 1,
        offchainEvents: acc.offchainEvents + (event.layer === "offchain" ? 1 : 0),
        onchainEvents: acc.onchainEvents + (event.layer === "onchain" ? 1 : 0),
        failedEvents: acc.failedEvents + (event.status === "failed" || event.eventType === "failure" ? 1 : 0),
        authorizedAtomic: (BigInt(acc.authorizedAtomic) + BigInt(event.authorizedDeltaAtomic)).toString(),
        settledAtomic: (BigInt(acc.settledAtomic) + BigInt(event.settledDeltaAtomic)).toString(),
        recoveredAtomic: (BigInt(acc.recoveredAtomic) + BigInt(event.recoveredAtomic)).toString(),
      }),
      {
        totalEvents: 0,
        offchainEvents: 0,
        onchainEvents: 0,
        failedEvents: 0,
        authorizedAtomic: "0",
        settledAtomic: "0",
        recoveredAtomic: "0",
      },
    );
    return { events, summary, truncated };
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
