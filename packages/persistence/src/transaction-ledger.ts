import type { JsonObject, PersistedChannel } from "@canalis/application";
import type { RouteFlow } from "@canalis/core";

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined || String(value) === "" ? undefined : String(value);
}

export async function recordFlowLedgerEvents(sql: any, taskId: string, flow: RouteFlow): Promise<void> {
  const authorizedDelta =
    flow.authorizationId && ["authorized", "fulfilled", "failed"].includes(flow.status)
      ? flow.nextCumulativeAtomic - flow.previousCumulativeAtomic
      : 0n;
  const metadata = {
    ...(flow.rejectionCode ? { rejectionCode: flow.rejectionCode } : {}),
    ...(flow.rejectionMessage ? { rejectionMessage: flow.rejectionMessage } : {}),
    ...(flow.errorMessage ? { errorMessage: flow.errorMessage } : {}),
    previousCumulativeAtomic: flow.previousCumulativeAtomic.toString(),
  };

  await sql`
    INSERT INTO transaction_events (
      id, task_id, provider_id, event_type, layer, status, protocol, network,
      mint, amount_atomic, cumulative_atomic, authorized_delta_atomic,
      channel_address, request_id, authorization_id, payment_reference,
      source_flow_id, metadata, created_at_unix
    )
    SELECT
      ${`authorization:${flow.id}`}, ${taskId}, ${flow.providerId},
      'authorization', 'offchain', ${flow.status},
      COALESCE(${flow.receipt?.protocol ?? null}, p.protocol, t.mode),
      COALESCE(c.network, 'application'), t.mint,
      ${flow.quotedAmountAtomic.toString()}::numeric,
      ${flow.nextCumulativeAtomic.toString()}::numeric,
      ${authorizedDelta.toString()}::numeric,
      c.channel_address, ${flow.requestId}, ${flow.authorizationId ?? null},
      ${flow.paymentReference ?? null}, ${flow.id}, ${sql.json(metadata)},
      ${flow.createdAtUnixSeconds.toString()}::bigint
    FROM tasks t
    LEFT JOIN providers p ON p.id = ${flow.providerId}
    LEFT JOIN channels c ON c.task_id = t.id AND c.provider_id = ${flow.providerId}
    WHERE t.id = ${taskId}
    ON CONFLICT (id) DO NOTHING
  `;

  if (!flow.receipt) return;
  const receipt = flow.receipt;
  await sql`
    INSERT INTO transaction_events (
      id, task_id, provider_id, event_type, layer, status, protocol, network,
      mint, amount_atomic, cumulative_atomic, channel_address, receipt_hash,
      request_id, authorization_id, payment_reference, source_flow_id, metadata,
      created_at_unix
    )
    SELECT
      ${`receipt:${flow.id}`}, ${taskId}, ${receipt.providerId},
      'receipt', 'offchain', 'fulfilled', ${receipt.protocol},
      COALESCE(c.network, 'application'), ${receipt.mint},
      ${receipt.priceAtomic.toString()}::numeric,
      ${flow.nextCumulativeAtomic.toString()}::numeric,
      c.channel_address, ${receipt.responseHash}, ${receipt.requestId},
      ${receipt.authorizationId}, ${receipt.paymentReference ?? null}, ${flow.id},
      ${sql.json(receipt.protocolMetadata ?? {})},
      ${receipt.timestampUnixSeconds.toString()}::bigint
    FROM tasks t
    LEFT JOIN channels c ON c.task_id = t.id AND c.provider_id = ${receipt.providerId}
    WHERE t.id = ${taskId}
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function recordSettlementLedgerEvent(
  sql: any,
  input: {
    taskId: string;
    providerId: string;
    cumulativeAmountAtomic: bigint;
    transactionSignature: string;
    createdAtUnixSeconds: bigint;
  },
): Promise<void> {
  const eventId = `settlement:${input.taskId}:${input.providerId}:${input.transactionSignature}`;
  await sql`
    INSERT INTO transaction_events (
      id, task_id, provider_id, event_type, layer, status, protocol, network,
      mint, amount_atomic, cumulative_atomic, settled_delta_atomic,
      channel_address, signature, metadata, created_at_unix
    )
    SELECT
      ${eventId}, ${input.taskId}, ${input.providerId}, 'settlement', 'onchain',
      'confirmed', COALESCE(p.protocol, t.mode), COALESCE(c.network, 'solana'),
      t.mint, ${input.cumulativeAmountAtomic.toString()}::numeric,
      ${input.cumulativeAmountAtomic.toString()}::numeric,
      GREATEST(
        ${input.cumulativeAmountAtomic.toString()}::numeric - COALESCE((
          SELECT MAX(te.cumulative_atomic)
          FROM transaction_events te
          WHERE te.task_id = ${input.taskId}
            AND te.provider_id = ${input.providerId}
            AND te.event_type = 'settlement'
            AND te.id <> ${eventId}
        ), 0),
        0
      ),
      c.channel_address, ${input.transactionSignature},
      jsonb_build_object('cumulativeSettlement', true),
      ${input.createdAtUnixSeconds.toString()}::bigint
    FROM tasks t
    LEFT JOIN providers p ON p.id = ${input.providerId}
    LEFT JOIN channels c ON c.task_id = t.id AND c.provider_id = ${input.providerId}
    WHERE t.id = ${input.taskId}
    ON CONFLICT (id) DO NOTHING
  `;
}

async function recordChannelEvent(
  sql: any,
  input: {
    id: string;
    taskId: string;
    providerId: string;
    eventType: "channel_open" | "distribution" | "recovery" | "failure";
    status: string;
    network: string;
    amountAtomic: bigint;
    cumulativeAtomic: bigint;
    recoveredAtomic?: bigint;
    channelAddress?: string;
    signature?: string;
    metadata?: JsonObject;
    createdAtUnixSeconds: bigint;
  },
): Promise<void> {
  await sql`
    INSERT INTO transaction_events (
      id, task_id, provider_id, event_type, layer, status, protocol, network,
      mint, amount_atomic, cumulative_atomic, recovered_atomic, channel_address,
      signature, metadata, created_at_unix
    )
    SELECT
      ${input.id}, ${input.taskId}, ${input.providerId}, ${input.eventType},
      'onchain', ${input.status}, COALESCE(p.protocol, t.mode), ${input.network},
      t.mint, ${input.amountAtomic.toString()}::numeric,
      ${input.cumulativeAtomic.toString()}::numeric,
      ${(input.recoveredAtomic ?? 0n).toString()}::numeric,
      ${input.channelAddress ?? null}, ${input.signature ?? null},
      ${sql.json(input.metadata ?? {})}, ${input.createdAtUnixSeconds.toString()}::bigint
    FROM tasks t
    LEFT JOIN providers p ON p.id = ${input.providerId}
    WHERE t.id = ${input.taskId}
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function recordChannelLedgerEvents(
  sql: any,
  current: PersistedChannel,
  next: PersistedChannel,
  updatedAtUnixSeconds: bigint,
): Promise<void> {
  if (
    next.openTransactionSignature &&
    next.openTransactionSignature !== current.openTransactionSignature
  ) {
    await recordChannelEvent(sql, {
      id: `channel_open:${next.taskId}:${next.providerId}:${next.openTransactionSignature}`,
      taskId: next.taskId,
      providerId: next.providerId,
      eventType: "channel_open",
      status: "confirmed",
      network: next.network,
      amountAtomic: next.ceilingAtomic,
      cumulativeAtomic: next.cumulativeAuthorizedAtomic,
      ...(next.channelAddress ? { channelAddress: next.channelAddress } : {}),
      signature: next.openTransactionSignature,
      metadata: { programAddress: next.programAddress },
      createdAtUnixSeconds: updatedAtUnixSeconds,
    });
  }

  if (
    next.settleTransactionSignature &&
    next.settleTransactionSignature !== current.settleTransactionSignature
  ) {
    await recordSettlementLedgerEvent(sql, {
      taskId: next.taskId,
      providerId: next.providerId,
      cumulativeAmountAtomic: next.cumulativeAuthorizedAtomic,
      transactionSignature: next.settleTransactionSignature,
      createdAtUnixSeconds: updatedAtUnixSeconds,
    });
  }

  if (
    next.distributionTransactionSignature &&
    next.distributionTransactionSignature !== current.distributionTransactionSignature
  ) {
    await recordChannelEvent(sql, {
      id: `distribution:${next.taskId}:${next.providerId}:${next.distributionTransactionSignature}`,
      taskId: next.taskId,
      providerId: next.providerId,
      eventType: "distribution",
      status: ["distributed", "recovered"].includes(next.status) ? "confirmed" : next.status,
      network: next.network,
      amountAtomic: next.cumulativeAuthorizedAtomic,
      cumulativeAtomic: next.cumulativeAuthorizedAtomic,
      ...(next.channelAddress ? { channelAddress: next.channelAddress } : {}),
      signature: next.distributionTransactionSignature,
      metadata: jsonObject(next.recoveryState),
      createdAtUnixSeconds: updatedAtUnixSeconds,
    });
  }

  if (
    next.refundTransactionSignature &&
    next.refundTransactionSignature !== current.refundTransactionSignature
  ) {
    const recovery = jsonObject(next.recoveryState);
    const rawRefunded = optionalString(recovery.refundedAtomic);
    let recoveredAtomic = next.ceilingAtomic - next.cumulativeAuthorizedAtomic;
    if (rawRefunded && /^\d+$/.test(rawRefunded)) recoveredAtomic = BigInt(rawRefunded);
    if (recoveredAtomic < 0n) recoveredAtomic = 0n;
    await recordChannelEvent(sql, {
      id: `recovery:${next.taskId}:${next.providerId}:${next.refundTransactionSignature}`,
      taskId: next.taskId,
      providerId: next.providerId,
      eventType: "recovery",
      status: "confirmed",
      network: next.network,
      amountAtomic: recoveredAtomic,
      cumulativeAtomic: next.cumulativeAuthorizedAtomic,
      recoveredAtomic,
      ...(next.channelAddress ? { channelAddress: next.channelAddress } : {}),
      signature: next.refundTransactionSignature,
      metadata: recovery,
      createdAtUnixSeconds: updatedAtUnixSeconds,
    });
  }

  const currentRecovery = jsonObject(current.recoveryState);
  const nextRecovery = jsonObject(next.recoveryState);
  const currentFailure = current.status === "failed" || currentRecovery.stage === "finalization-ambiguous";
  const nextFailure = next.status === "failed" || nextRecovery.stage === "finalization-ambiguous";
  if (nextFailure && (!currentFailure || currentRecovery.operationId !== nextRecovery.operationId)) {
    const failureKey = optionalString(nextRecovery.operationId) ?? updatedAtUnixSeconds.toString();
    await recordChannelEvent(sql, {
      id: `failure:${next.taskId}:${next.providerId}:${failureKey}`,
      taskId: next.taskId,
      providerId: next.providerId,
      eventType: "failure",
      status: "failed",
      network: next.network,
      amountAtomic: 0n,
      cumulativeAtomic: next.cumulativeAuthorizedAtomic,
      ...(next.channelAddress ? { channelAddress: next.channelAddress } : {}),
      metadata: nextRecovery,
      createdAtUnixSeconds: updatedAtUnixSeconds,
    });
  }
}
