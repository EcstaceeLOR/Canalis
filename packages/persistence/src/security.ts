import postgres, { type Sql } from "postgres";

export type IdempotencyReplay = {
  status: "replay";
  responseStatus: number;
  responseBody: string;
  responseContentType: string;
};

export type IdempotencyBeginResult =
  | { status: "acquired" }
  | { status: "in-progress" }
  | { status: "conflict" }
  | IdempotencyReplay;

export type RateLimitResult = {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
};

export type AuditEventRecord = {
  id: string;
  ownerWallet: string;
  actorWallet?: string;
  resourceType: string;
  resourceId: string;
  action: "insert" | "update" | "delete";
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  createdAt: string;
};

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export class PostgresSecurityRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 4, prepare: false });
  }

  async beginIdempotency(input: {
    ownerWallet: string;
    operation: string;
    idempotencyKey: string;
    requestHash: string;
    leaseSeconds?: number;
    ttlSeconds?: number;
  }): Promise<IdempotencyBeginResult> {
    const leaseSeconds = Math.max(15, Math.min(300, input.leaseSeconds ?? 120));
    const ttlSeconds = Math.max(300, Math.min(172_800, input.ttlSeconds ?? 86_400));

    await this.sql`
      DELETE FROM idempotency_records
      WHERE expires_at < NOW()
    `;

    const inserted = await this.sql<{ idempotency_key: string }[]>`
      INSERT INTO idempotency_records (
        owner_wallet, operation, idempotency_key, request_hash, state,
        lease_expires_at, expires_at
      ) VALUES (
        ${input.ownerWallet}, ${input.operation}, ${input.idempotencyKey},
        ${input.requestHash}, 'in_progress',
        NOW() + ${leaseSeconds} * INTERVAL '1 second',
        NOW() + ${ttlSeconds} * INTERVAL '1 second'
      )
      ON CONFLICT DO NOTHING
      RETURNING idempotency_key
    `;
    if (inserted.length > 0) return { status: "acquired" };

    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT request_hash, state, response_status, response_body,
             response_content_type, lease_expires_at
      FROM idempotency_records
      WHERE owner_wallet = ${input.ownerWallet}
        AND operation = ${input.operation}
        AND idempotency_key = ${input.idempotencyKey}
      LIMIT 1
    `;
    const current = rows[0];
    if (!current) return { status: "in-progress" };
    if (String(current.request_hash) !== input.requestHash) return { status: "conflict" };

    if (current.state === "completed") {
      return {
        status: "replay",
        responseStatus: Number(current.response_status ?? 200),
        responseBody: String(current.response_body ?? ""),
        responseContentType: String(current.response_content_type ?? "application/json; charset=utf-8"),
      };
    }

    const reclaimed = await this.sql<{ idempotency_key: string }[]>`
      UPDATE idempotency_records
      SET lease_expires_at = NOW() + ${leaseSeconds} * INTERVAL '1 second',
          expires_at = NOW() + ${ttlSeconds} * INTERVAL '1 second',
          updated_at = NOW()
      WHERE owner_wallet = ${input.ownerWallet}
        AND operation = ${input.operation}
        AND idempotency_key = ${input.idempotencyKey}
        AND request_hash = ${input.requestHash}
        AND state = 'in_progress'
        AND lease_expires_at <= NOW()
      RETURNING idempotency_key
    `;
    return reclaimed.length > 0 ? { status: "acquired" } : { status: "in-progress" };
  }

  async completeIdempotency(input: {
    ownerWallet: string;
    operation: string;
    idempotencyKey: string;
    requestHash: string;
    responseStatus: number;
    responseBody: string;
    responseContentType?: string;
    ttlSeconds?: number;
  }): Promise<void> {
    const ttlSeconds = Math.max(300, Math.min(172_800, input.ttlSeconds ?? 86_400));
    await this.sql`
      UPDATE idempotency_records
      SET state = 'completed',
          response_status = ${input.responseStatus},
          response_body = ${input.responseBody},
          response_content_type = ${input.responseContentType ?? "application/json; charset=utf-8"},
          lease_expires_at = NOW(),
          expires_at = NOW() + ${ttlSeconds} * INTERVAL '1 second',
          updated_at = NOW()
      WHERE owner_wallet = ${input.ownerWallet}
        AND operation = ${input.operation}
        AND idempotency_key = ${input.idempotencyKey}
        AND request_hash = ${input.requestHash}
    `;
  }

  async acquireMutationLock(input: {
    resourceKey: string;
    ownerWallet: string;
    operation: string;
    holderKey: string;
    ttlSeconds?: number;
  }): Promise<boolean> {
    const ttlSeconds = Math.max(10, Math.min(300, input.ttlSeconds ?? 120));
    const rows = await this.sql<{ holder_key: string }[]>`
      INSERT INTO mutation_locks (
        resource_key, owner_wallet, operation, holder_key, acquired_at, expires_at
      ) VALUES (
        ${input.resourceKey}, ${input.ownerWallet}, ${input.operation}, ${input.holderKey},
        NOW(), NOW() + ${ttlSeconds} * INTERVAL '1 second'
      )
      ON CONFLICT (resource_key) DO UPDATE SET
        owner_wallet = EXCLUDED.owner_wallet,
        operation = EXCLUDED.operation,
        holder_key = EXCLUDED.holder_key,
        acquired_at = NOW(),
        expires_at = EXCLUDED.expires_at
      WHERE mutation_locks.expires_at <= NOW()
         OR mutation_locks.holder_key = EXCLUDED.holder_key
      RETURNING holder_key
    `;
    return rows.some((row) => row.holder_key === input.holderKey);
  }

  async releaseMutationLock(resourceKey: string, holderKey: string): Promise<void> {
    await this.sql`
      DELETE FROM mutation_locks
      WHERE resource_key = ${resourceKey} AND holder_key = ${holderKey}
    `;
  }

  async consumeRateLimit(input: {
    scopeKey: string;
    limit: number;
    windowSeconds: number;
  }): Promise<RateLimitResult> {
    const limit = Math.max(1, Math.min(10_000, Math.floor(input.limit)));
    const windowSeconds = Math.max(1, Math.min(3_600, Math.floor(input.windowSeconds)));
    const rows = await this.sql<Record<string, unknown>[]>`
      INSERT INTO api_rate_limits (scope_key, window_started_at, request_count, updated_at)
      VALUES (${input.scopeKey}, NOW(), 1, NOW())
      ON CONFLICT (scope_key) DO UPDATE SET
        request_count = CASE
          WHEN api_rate_limits.window_started_at <= NOW() - ${windowSeconds} * INTERVAL '1 second'
            THEN 1
          ELSE api_rate_limits.request_count + 1
        END,
        window_started_at = CASE
          WHEN api_rate_limits.window_started_at <= NOW() - ${windowSeconds} * INTERVAL '1 second'
            THEN NOW()
          ELSE api_rate_limits.window_started_at
        END,
        updated_at = NOW()
      RETURNING request_count,
        GREATEST(
          1,
          CEIL(EXTRACT(EPOCH FROM (window_started_at + ${windowSeconds} * INTERVAL '1 second' - NOW())))::integer
        ) AS retry_after_seconds
    `;
    const row = rows[0];
    const count = Number(row?.request_count ?? 1);
    return {
      allowed: count <= limit,
      count,
      limit,
      retryAfterSeconds: Number(row?.retry_after_seconds ?? windowSeconds),
    };
  }

  async listAuditEvents(ownerWallet: string, limit = 100): Promise<AuditEventRecord[]> {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT id, owner_wallet, actor_wallet, resource_type, resource_id,
             action, before_state, after_state, created_at
      FROM audit_events
      WHERE owner_wallet = ${ownerWallet}
      ORDER BY created_at DESC, id DESC
      LIMIT ${boundedLimit}
    `;
    return rows.map((row) => ({
      id: String(row.id),
      ownerWallet: String(row.owner_wallet),
      ...(row.actor_wallet ? { actorWallet: String(row.actor_wallet) } : {}),
      resourceType: String(row.resource_type),
      resourceId: String(row.resource_id),
      action: String(row.action) as AuditEventRecord["action"],
      ...(objectValue(row.before_state) ? { beforeState: objectValue(row.before_state) } : {}),
      ...(objectValue(row.after_state) ? { afterState: objectValue(row.after_state) } : {}),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
