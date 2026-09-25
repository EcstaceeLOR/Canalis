import postgres, { type Sql } from "postgres";

export type FinalizationLeaseResult =
  | "acquired"
  | "busy"
  | "terminal"
  | "not-open"
  | "missing";

export class PostgresLiveChannelRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 3, prepare: false });
  }

  async beginFinalization(input: {
    taskId: string;
    providerId: string;
    cumulativeAmountAtomic: bigint;
    startedAtUnixSeconds: bigint;
  }): Promise<FinalizationLeaseResult> {
    const operationId = `${input.taskId}:${input.providerId}:${input.startedAtUnixSeconds.toString()}`;
    const marker = {
      stage: "finalization-started",
      operationId,
      attemptedSettledAtomic: input.cumulativeAmountAtomic.toString(),
      startedAtUnixSeconds: input.startedAtUnixSeconds.toString(),
    };

    const acquired = await this.sql<{ status: string }[]>`
      UPDATE channels
      SET recovery_state = COALESCE(recovery_state, '{}'::jsonb) || ${this.sql.json(marker)},
          updated_at_unix = ${input.startedAtUnixSeconds.toString()}
      WHERE task_id = ${input.taskId}
        AND provider_id = ${input.providerId}
        AND status = 'open'
        AND COALESCE(recovery_state->>'stage', '') NOT IN (
          'finalization-started',
          'finalization-ambiguous'
        )
      RETURNING status
    `;
    if (acquired.length > 0) return "acquired";

    const rows = await this.sql<{ status: string; recovery_state: unknown }[]>`
      SELECT status, recovery_state
      FROM channels
      WHERE task_id = ${input.taskId} AND provider_id = ${input.providerId}
      LIMIT 1
    `;
    const current = rows[0];
    if (!current) return "missing";
    if (["distributed", "recovered"].includes(current.status)) return "terminal";

    const recovery = current.recovery_state;
    const stage = recovery && typeof recovery === "object" && !Array.isArray(recovery)
      ? String((recovery as Record<string, unknown>).stage ?? "")
      : "";
    if (["finalization-started", "finalization-ambiguous"].includes(stage)) return "busy";
    return "not-open";
  }

  async recordSettlement(input: {
    taskId: string;
    providerId: string;
    cumulativeAmountAtomic: bigint;
    transactionSignature: string;
  }): Promise<void> {
    await this.sql`
      INSERT INTO settlements (
        task_id, provider_id, cumulative_amount_atomic, transaction_signature
      ) VALUES (
        ${input.taskId}, ${input.providerId},
        ${input.cumulativeAmountAtomic.toString()}, ${input.transactionSignature}
      )
      ON CONFLICT DO NOTHING
    `;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
