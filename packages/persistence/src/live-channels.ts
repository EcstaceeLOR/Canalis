import postgres, { type Sql } from "postgres";

export class PostgresLiveChannelRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 3, prepare: false });
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
