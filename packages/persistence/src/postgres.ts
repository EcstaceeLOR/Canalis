import type {
  CanalisRepository,
  ChannelUpdate,
  PersistedChannel,
  PersistedProvider,
  PersistedTask,
} from "@canalis/application";
import type {
  RouteFlow,
  RouteSettlementRecord,
  TaskPaymentGraph,
  TaskStatus,
} from "@canalis/core";
import type { ProviderProtocol, ProviderReceipt } from "@canalis/providers";
import postgres, { type Sql } from "postgres";

function big(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  return BigInt(String(value));
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function mapTask(row: Record<string, unknown>): PersistedTask {
  const capsRaw = objectValue(row.provider_caps_atomic) ?? {};
  const providerCapsAtomic = Object.fromEntries(
    Object.entries(capsRaw).map(([key, value]) => [key, big(value)]),
  );
  const allowed = Array.isArray(row.allowed_provider_ids)
    ? row.allowed_provider_ids.map(String)
    : [];

  return {
    id: String(row.id),
    owner: String(row.owner),
    agentId: String(row.agent_id),
    mode: String(row.mode) as PersistedTask["mode"],
    budget: {
      mint: String(row.mint),
      totalAtomic: big(row.budget_atomic),
    },
    policy: {
      allowedProviderIds: allowed,
      ...(row.max_per_call_atomic !== null && row.max_per_call_atomic !== undefined
        ? { maxPerCallAtomic: big(row.max_per_call_atomic) }
        : {}),
      providerCapsAtomic,
    },
    status: String(row.status) as PersistedTask["status"],
    createdAtUnixSeconds: big(row.created_at_unix),
    expiresAtUnixSeconds: big(row.expires_at_unix),
    updatedAtUnixSeconds: big(row.updated_at_unix),
  };
}

function mapChannel(row: Record<string, unknown>): PersistedChannel {
  return {
    taskId: String(row.task_id),
    providerId: String(row.provider_id),
    programAddress: String(row.program_address),
    network: String(row.network),
    ...(optionalString(row.channel_address)
      ? { channelAddress: optionalString(row.channel_address) }
      : {}),
    ceilingAtomic: big(row.ceiling_atomic),
    cumulativeAuthorizedAtomic: big(row.cumulative_authorized_atomic),
    spentAtomic: big(row.spent_atomic),
    status: String(row.status) as PersistedChannel["status"],
    ...(optionalString(row.open_transaction_signature)
      ? { openTransactionSignature: optionalString(row.open_transaction_signature) }
      : {}),
    ...(optionalString(row.settle_transaction_signature)
      ? { settleTransactionSignature: optionalString(row.settle_transaction_signature) }
      : {}),
    ...(optionalString(row.distribution_transaction_signature)
      ? { distributionTransactionSignature: optionalString(row.distribution_transaction_signature) }
      : {}),
    ...(optionalString(row.refund_transaction_signature)
      ? { refundTransactionSignature: optionalString(row.refund_transaction_signature) }
      : {}),
    ...(objectValue(row.recovery_state)
      ? { recoveryState: objectValue(row.recovery_state) }
      : {}),
    createdAtUnixSeconds: big(row.created_at_unix),
    updatedAtUnixSeconds: big(row.updated_at_unix),
  };
}

export class PostgresCanalisRepository implements CanalisRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 5, prepare: false });
  }

  async createTask(
    task: PersistedTask,
    channels: readonly PersistedChannel[],
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`
        INSERT INTO tasks (
          id, owner, agent_id, mode, mint, budget_atomic, status,
          created_at_unix, expires_at_unix, updated_at_unix
        ) VALUES (
          ${task.id}, ${task.owner}, ${task.agentId}, ${task.mode},
          ${task.budget.mint}, ${task.budget.totalAtomic.toString()}, ${task.status},
          ${task.createdAtUnixSeconds.toString()}, ${task.expiresAtUnixSeconds.toString()},
          ${task.updatedAtUnixSeconds.toString()}
        )
      `;
      const caps = Object.fromEntries(
        Object.entries(task.policy.providerCapsAtomic ?? {}).map(([key, value]) => [
          key,
          value.toString(),
        ]),
      );
      await tx`
        INSERT INTO policies (
          task_id, allowed_provider_ids, max_per_call_atomic, provider_caps_atomic
        ) VALUES (
          ${task.id}, ${tx.json([...task.policy.allowedProviderIds])},
          ${task.policy.maxPerCallAtomic?.toString() ?? null}, ${tx.json(caps)}
        )
      `;

      for (const channel of channels) {
        await tx`
          INSERT INTO channels (
            task_id, provider_id, program_address, network, channel_address,
            ceiling_atomic, cumulative_authorized_atomic, spent_atomic, status,
            open_transaction_signature, settle_transaction_signature,
            distribution_transaction_signature, refund_transaction_signature,
            recovery_state, created_at_unix, updated_at_unix
          ) VALUES (
            ${channel.taskId}, ${channel.providerId}, ${channel.programAddress},
            ${channel.network}, ${channel.channelAddress ?? null},
            ${channel.ceilingAtomic.toString()},
            ${channel.cumulativeAuthorizedAtomic.toString()},
            ${channel.spentAtomic.toString()}, ${channel.status},
            ${channel.openTransactionSignature ?? null},
            ${channel.settleTransactionSignature ?? null},
            ${channel.distributionTransactionSignature ?? null},
            ${channel.refundTransactionSignature ?? null},
            ${channel.recoveryState ? tx.json(channel.recoveryState) : null},
            ${channel.createdAtUnixSeconds.toString()},
            ${channel.updatedAtUnixSeconds.toString()}
          )
        `;
      }
    });
  }

  async getTask(taskId: string): Promise<PersistedTask | null> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT t.*, p.allowed_provider_ids, p.max_per_call_atomic, p.provider_caps_atomic
      FROM tasks t
      JOIN policies p ON p.task_id = t.id
      WHERE t.id = ${taskId}
      LIMIT 1
    `;
    return rows[0] ? mapTask(rows[0]) : null;
  }

  async listTasks(limit = 50): Promise<PersistedTask[]> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT t.*, p.allowed_provider_ids, p.max_per_call_atomic, p.provider_caps_atomic
      FROM tasks t
      JOIN policies p ON p.task_id = t.id
      ORDER BY t.updated_at_unix DESC
      LIMIT ${limit}
    `;
    return rows.map(mapTask);
  }

  async getChannels(taskId: string): Promise<PersistedChannel[]> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM channels
      WHERE task_id = ${taskId}
      ORDER BY provider_id ASC
    `;
    return rows.map(mapChannel);
  }

  async getFlows(taskId: string): Promise<RouteFlow[]> {
    const [flowRows, receiptRows] = await Promise.all([
      this.sql<Record<string, unknown>[]>`
        SELECT * FROM flows WHERE task_id = ${taskId}
        ORDER BY created_at_unix ASC, id ASC
      `,
      this.sql<Record<string, unknown>[]>`
        SELECT * FROM receipts WHERE task_id = ${taskId}
      `,
    ]);
    const receipts = new Map<string, ProviderReceipt>();
    for (const row of receiptRows) {
      receipts.set(String(row.flow_id), {
        providerId: String(row.provider_id),
        requestId: String(row.request_id),
        mint: String(row.mint),
        priceAtomic: big(row.price_atomic),
        protocol: String(row.protocol) as ProviderProtocol,
        authorizationId: String(row.authorization_id),
        ...(optionalString(row.payment_reference)
          ? { paymentReference: optionalString(row.payment_reference) }
          : {}),
        responseHash: String(row.response_hash),
        timestampUnixSeconds: big(row.timestamp_unix),
        ...(objectValue(row.protocol_metadata)
          ? {
              protocolMetadata: Object.fromEntries(
                Object.entries(objectValue(row.protocol_metadata)!).map(([key, value]) => [
                  key,
                  String(value),
                ]),
              ),
            }
          : {}),
      });
    }

    return flowRows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      providerId: String(row.provider_id),
      requestId: String(row.request_id),
      status: String(row.status) as RouteFlow["status"],
      quotedAmountAtomic: big(row.quoted_amount_atomic),
      previousCumulativeAtomic: big(row.previous_cumulative_atomic),
      nextCumulativeAtomic: big(row.next_cumulative_atomic),
      ...(optionalString(row.rejection_code)
        ? { rejectionCode: optionalString(row.rejection_code) as RouteFlow["rejectionCode"] }
        : {}),
      ...(optionalString(row.rejection_message)
        ? { rejectionMessage: optionalString(row.rejection_message) }
        : {}),
      ...(optionalString(row.authorization_id)
        ? { authorizationId: optionalString(row.authorization_id) }
        : {}),
      ...(optionalString(row.payment_reference)
        ? { paymentReference: optionalString(row.payment_reference) }
        : {}),
      ...(receipts.get(String(row.id)) ? { receipt: receipts.get(String(row.id)) } : {}),
      ...(optionalString(row.error_message)
        ? { errorMessage: optionalString(row.error_message) }
        : {}),
      ...(optionalString(row.settlement_transaction_signature)
        ? { settlementTransactionSignature: optionalString(row.settlement_transaction_signature) }
        : {}),
      createdAtUnixSeconds: big(row.created_at_unix),
    }));
  }

  async getSettlements(taskId: string): Promise<RouteSettlementRecord[]> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT provider_id, cumulative_amount_atomic, transaction_signature
      FROM settlements
      WHERE task_id = ${taskId}
      ORDER BY created_at ASC
    `;
    return rows.map((row) => ({
      providerId: String(row.provider_id),
      cumulativeAmountAtomic: big(row.cumulative_amount_atomic),
      transactionSignature: String(row.transaction_signature),
    }));
  }

  async listProviders(): Promise<PersistedProvider[]> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM providers ORDER BY id ASC
    `;
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      payee: String(row.payee),
      protocol: String(row.protocol) as PersistedProvider["protocol"],
      description: String(row.description),
      mode: String(row.mode) as PersistedProvider["mode"],
      ...(optionalString(row.endpoint) ? { endpoint: optionalString(row.endpoint) } : {}),
      ...(objectValue(row.config) ? { config: objectValue(row.config) } : {}),
    }));
  }

  async saveExecution(
    taskId: string,
    graph: TaskPaymentGraph,
    status: TaskStatus,
    updatedAtUnixSeconds: bigint,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      for (const provider of graph.providers) {
        await tx`
          UPDATE channels
          SET cumulative_authorized_atomic = ${provider.cumulativeAuthorizedAtomic.toString()},
              spent_atomic = ${provider.spentAtomic.toString()},
              updated_at_unix = ${updatedAtUnixSeconds.toString()}
          WHERE task_id = ${taskId} AND provider_id = ${provider.providerId}
        `;
      }

      for (const flow of graph.flows) {
        await tx`
          INSERT INTO flows (
            id, task_id, provider_id, request_id, status, quoted_amount_atomic,
            previous_cumulative_atomic, next_cumulative_atomic, rejection_code,
            rejection_message, authorization_id, payment_reference, error_message,
            settlement_transaction_signature, created_at_unix
          ) VALUES (
            ${flow.id}, ${flow.taskId}, ${flow.providerId}, ${flow.requestId}, ${flow.status},
            ${flow.quotedAmountAtomic.toString()}, ${flow.previousCumulativeAtomic.toString()},
            ${flow.nextCumulativeAtomic.toString()}, ${flow.rejectionCode ?? null},
            ${flow.rejectionMessage ?? null}, ${flow.authorizationId ?? null},
            ${flow.paymentReference ?? null}, ${flow.errorMessage ?? null},
            ${flow.settlementTransactionSignature ?? null},
            ${flow.createdAtUnixSeconds.toString()}
          )
          ON CONFLICT (id) DO NOTHING
        `;

        if (flow.receipt) {
          await tx`
            INSERT INTO receipts (
              flow_id, task_id, provider_id, request_id, mint, price_atomic, protocol,
              authorization_id, payment_reference, response_hash, timestamp_unix,
              protocol_metadata
            ) VALUES (
              ${flow.id}, ${taskId}, ${flow.receipt.providerId}, ${flow.receipt.requestId},
              ${flow.receipt.mint}, ${flow.receipt.priceAtomic.toString()},
              ${flow.receipt.protocol}, ${flow.receipt.authorizationId},
              ${flow.receipt.paymentReference ?? null}, ${flow.receipt.responseHash},
              ${flow.receipt.timestampUnixSeconds.toString()},
              ${flow.receipt.protocolMetadata ? tx.json(flow.receipt.protocolMetadata) : null}
            )
            ON CONFLICT (flow_id) DO NOTHING
          `;
        }
      }

      for (const settlement of graph.settlements) {
        await tx`
          INSERT INTO settlements (
            task_id, provider_id, cumulative_amount_atomic, transaction_signature
          ) VALUES (
            ${taskId}, ${settlement.providerId},
            ${settlement.cumulativeAmountAtomic.toString()}, ${settlement.transactionSignature}
          )
          ON CONFLICT DO NOTHING
        `;
      }

      await tx`
        UPDATE tasks
        SET status = ${status}, updated_at_unix = ${updatedAtUnixSeconds.toString()}
        WHERE id = ${taskId}
      `;
    });
  }

  async updateChannel(
    taskId: string,
    providerId: string,
    update: ChannelUpdate,
    updatedAtUnixSeconds: bigint,
  ): Promise<void> {
    const current = (await this.getChannels(taskId)).find(
      (channel) => channel.providerId === providerId,
    );
    if (!current) return;
    const next = { ...current, ...update };
    await this.sql`
      UPDATE channels
      SET channel_address = ${next.channelAddress ?? null},
          cumulative_authorized_atomic = ${next.cumulativeAuthorizedAtomic.toString()},
          spent_atomic = ${next.spentAtomic.toString()},
          status = ${next.status},
          open_transaction_signature = ${next.openTransactionSignature ?? null},
          settle_transaction_signature = ${next.settleTransactionSignature ?? null},
          distribution_transaction_signature = ${next.distributionTransactionSignature ?? null},
          refund_transaction_signature = ${next.refundTransactionSignature ?? null},
          recovery_state = ${next.recoveryState ? this.sql.json(next.recoveryState) : null},
          updated_at_unix = ${updatedAtUnixSeconds.toString()}
      WHERE task_id = ${taskId} AND provider_id = ${providerId}
    `;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
