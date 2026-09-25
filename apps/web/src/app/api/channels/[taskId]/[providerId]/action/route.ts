import { NextResponse } from "next/server";
import {
  ApplicationError,
  channelActionFor,
  parseChannelAction,
  type TaskDetailDto,
} from "@canalis/application";
import { SOLANA_DEVNET_CAIP2 } from "@canalis/solana";
import type { PaymentPayload } from "@x402/core/types";
import { apiErrorResponse, readJsonBody } from "../../../../../../server/api";
import { assertWalletOwnsTask, requireWalletSession } from "../../../../../../server/auth";
import { getCanalisApplication } from "../../../../../../server/canalis";
import {
  getLiveChannelGateway,
  getLiveSettlementRepository,
  paymentRequiredFromChannel,
  requireLiveTask,
} from "../../../../../../server/live-channels";

function savedPayload(channel: TaskDetailDto["channels"][number]): PaymentPayload {
  const payload = channel.recoveryState?.paymentPayload as PaymentPayload | undefined;
  if (!payload || payload.x402Version !== 2 || !payload.payload) {
    throw new ApplicationError(
      "LIVE_CHANNEL_OPEN_EVIDENCE_MISSING",
      `Provider ${channel.providerId} is missing its persisted signed open payload.`,
      409,
    );
  }
  return payload;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string; providerId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { taskId, providerId } = await params;
    const action = parseChannelAction(await readJsonBody(request));
    const application = await getCanalisApplication();
    let task = await application.getTask(taskId);
    assertWalletOwnsTask(task, identity);
    requireLiveTask(task);

    const channel = task.channels.find((candidate) => candidate.providerId === providerId);
    if (!channel) throw new ApplicationError("CHANNEL_NOT_FOUND", "Channel not found.", 404);
    if (channel.network !== SOLANA_DEVNET_CAIP2) {
      throw new ApplicationError(
        "CHANNEL_NETWORK_MISMATCH",
        "This Canalis session can only operate Solana devnet payment channels.",
        409,
      );
    }
    if (["distributed", "recovered"].includes(channel.status)) {
      return NextResponse.json({ task, providerId, status: channel.status, idempotent: true });
    }

    const recoveryStage = typeof channel.recoveryState?.stage === "string" ? channel.recoveryState.stage : undefined;
    const automaticRetryBlocked = channel.recoveryState?.automaticRetryBlocked === true;
    const expected = channelActionFor({
      status: channel.status,
      taskStatus: task.task.status,
      cumulativeAuthorizedAtomic: BigInt(channel.cumulativeAuthorizedAtomic),
      expiresAtUnixSeconds: BigInt(task.task.expiresAtUnixSeconds),
      nowUnixSeconds: BigInt(Math.floor(Date.now() / 1000)),
      ...(recoveryStage ? { recoveryStage } : {}),
      automaticRetryBlocked,
    });
    if (expected === "inspect") {
      throw new ApplicationError(
        "CHANNEL_RECOVERY_REQUIRED",
        "A previous terminal attempt may have reached Solana. Inspect and reconcile the channel before any retry.",
        409,
      );
    }
    if (expected !== action) {
      throw new ApplicationError(
        "CHANNEL_ACTION_NOT_ALLOWED",
        expected
          ? `This channel currently permits only the ${expected} action.`
          : "This channel has no safe terminal action in its current state.",
        409,
      );
    }

    const paymentRequired = paymentRequiredFromChannel(channel);
    const paymentPayload = savedPayload(channel);
    const settledAtomic = BigInt(channel.cumulativeAuthorizedAtomic);
    const settlements = getLiveSettlementRepository();
    const lease = await settlements.beginFinalization({
      taskId,
      providerId,
      cumulativeAmountAtomic: settledAtomic,
      startedAtUnixSeconds: BigInt(Math.floor(Date.now() / 1000)),
    });
    if (lease !== "acquired") {
      if (lease === "terminal") {
        task = await application.getTask(taskId);
        return NextResponse.json({ task, providerId, idempotent: true });
      }
      throw new ApplicationError(
        lease === "busy" ? "CHANNEL_RECOVERY_REQUIRED" : "CHANNEL_ACTION_NOT_ALLOWED",
        lease === "busy"
          ? "Another or previous finalization attempt owns this channel. Automatic rebroadcast is blocked."
          : `Channel cannot begin finalization from its current state (${lease}).`,
        409,
      );
    }

    try {
      const result = await getLiveChannelGateway().claim(
        paymentPayload,
        paymentRequired.accepts[0]!,
        settledAtomic,
      );
      const refundedAtomic = BigInt(result.refundedAtomic);
      const status = settledAtomic === 0n ? "recovered" : "distributed";
      task = await application.recordChannelState(taskId, providerId, {
        status,
        settleTransactionSignature: result.transactionSignature,
        distributionTransactionSignature: result.transactionSignature,
        ...(refundedAtomic > 0n ? { refundTransactionSignature: result.transactionSignature } : {}),
        recoveryState: {
          ...(channel.recoveryState ?? {}),
          stage: "finalized",
          settledAtomic: result.settledAtomic,
          refundedAtomic: result.refundedAtomic,
          finalizationTransactionSignature: result.transactionSignature,
        },
      });
      await settlements.recordSettlement({
        taskId,
        providerId,
        cumulativeAmountAtomic: settledAtomic,
        transactionSignature: result.transactionSignature,
      });
      return NextResponse.json({ task, providerId, status, result });
    } catch (caught) {
      const errorMessage = caught instanceof Error ? caught.message : "Unknown finalization error.";
      await application.recordChannelState(taskId, providerId, {
        status: "failed",
        recoveryState: {
          ...(channel.recoveryState ?? {}),
          stage: "finalization-ambiguous",
          automaticRetryBlocked: true,
          error: errorMessage,
        },
      });
      throw new ApplicationError(
        "CHANNEL_FINALIZATION_AMBIGUOUS",
        "The terminal transaction could not be confirmed safely. Automatic retry is blocked until the channel is reconciled.",
        502,
        { providerId, cause: errorMessage },
      );
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
