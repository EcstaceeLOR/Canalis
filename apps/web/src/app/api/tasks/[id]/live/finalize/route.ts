import { NextResponse } from "next/server";
import { ApplicationError, type TaskDetailDto } from "@canalis/application";
import { apiErrorResponse } from "../../../../../../server/api";
import { assertWalletOwnsTask, requireWalletSession } from "../../../../../../server/auth";
import { getCanalisApplication } from "../../../../../../server/canalis";
import {
  getLiveChannelGateway,
  getLiveSettlementRepository,
  paymentRequiredFromChannel,
  requireLiveTask,
} from "../../../../../../server/live-channels";
import { runIdempotentMutation } from "../../../../../../server/security";
import type { PaymentPayload } from "@x402/core/types";

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

function recoveryStage(channel: TaskDetailDto["channels"][number]) {
  const value = channel.recoveryState?.stage;
  return typeof value === "string" ? value : "";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { id } = await params;
    return await runIdempotentMutation({
      request,
      ownerWallet: identity.walletAddress,
      operation: "task.live.finalize",
      resourceKey: `task:${id}:finalization`,
      handler: async () => {
        const application = await getCanalisApplication();
        let task = await application.getTask(id);
        assertWalletOwnsTask(task, identity);
        requireLiveTask(task);
        if (task.graph.flows.length === 0 && task.task.status === "active") {
          throw new ApplicationError(
            "LIVE_TASK_NOT_EXECUTED",
            "Run the task before finalizing, or cancel it before recovering unused channels.",
            409,
          );
        }

        const gateway = getLiveChannelGateway();
        const settlements = getLiveSettlementRepository();
        const results: Array<Record<string, unknown>> = [];
        let partial = false;

        for (const current of task.channels) {
          if (["distributed", "recovered"].includes(current.status)) {
            results.push({ providerId: current.providerId, status: current.status, idempotent: true });
            continue;
          }

          const stage = recoveryStage(current);
          if (
            current.status === "failed" ||
            ["finalization-started", "finalization-ambiguous"].includes(stage)
          ) {
            partial = true;
            results.push({
              providerId: current.providerId,
              status: current.status,
              recoveryRequired: true,
              error: "A previous terminal attempt may have reached Solana. Automatic rebroadcast is blocked until the channel is reconciled.",
            });
            continue;
          }

          if (current.status !== "open") {
            partial = true;
            results.push({ providerId: current.providerId, status: current.status, error: "Channel is not open." });
            continue;
          }

          let paymentRequired;
          let paymentPayload: PaymentPayload;
          let settledAtomic: bigint;
          try {
            paymentRequired = paymentRequiredFromChannel(current);
            paymentPayload = savedPayload(current);
            settledAtomic = BigInt(current.cumulativeAuthorizedAtomic);
          } catch (caught) {
            partial = true;
            results.push({
              providerId: current.providerId,
              status: current.status,
              error: caught instanceof Error ? caught.message : "Channel finalization evidence is invalid.",
            });
            continue;
          }

          const lease = await settlements.beginFinalization({
            taskId: id,
            providerId: current.providerId,
            cumulativeAmountAtomic: settledAtomic,
            startedAtUnixSeconds: BigInt(Math.floor(Date.now() / 1000)),
          });
          if (lease !== "acquired") {
            partial = true;
            results.push({
              providerId: current.providerId,
              status: current.status,
              recoveryRequired: lease === "busy",
              idempotent: lease === "terminal",
              error: lease === "busy"
                ? "Another or previous finalization attempt owns this channel. Automatic rebroadcast is blocked."
                : lease === "terminal"
                  ? undefined
                  : `Channel cannot begin finalization from its current state (${lease}).`,
            });
            continue;
          }

          try {
            const result = await gateway.claim(
              paymentPayload,
              paymentRequired.accepts[0],
              settledAtomic,
            );
            const refundedAtomic = BigInt(result.refundedAtomic);
            const status = settledAtomic === 0n ? "recovered" : "distributed";
            task = await application.recordChannelState(id, current.providerId, {
              status,
              settleTransactionSignature: result.transactionSignature,
              distributionTransactionSignature: result.transactionSignature,
              ...(refundedAtomic > 0n ? { refundTransactionSignature: result.transactionSignature } : {}),
              recoveryState: {
                ...(current.recoveryState ?? {}),
                stage: "finalized",
                settledAtomic: result.settledAtomic,
                refundedAtomic: result.refundedAtomic,
                finalizationTransactionSignature: result.transactionSignature,
              },
            });
            await settlements.recordSettlement({
              taskId: id,
              providerId: current.providerId,
              cumulativeAmountAtomic: settledAtomic,
              transactionSignature: result.transactionSignature,
            });
            results.push({ providerId: current.providerId, status, ...result });
          } catch (caught) {
            partial = true;
            const errorMessage = caught instanceof Error ? caught.message : "Unknown finalization error.";
            task = await application.recordChannelState(id, current.providerId, {
              status: "failed",
              recoveryState: {
                ...(current.recoveryState ?? {}),
                stage: "finalization-ambiguous",
                automaticRetryBlocked: true,
                error: errorMessage,
              },
            });
            results.push({
              providerId: current.providerId,
              status: "failed",
              recoveryRequired: true,
              error: "Finalization could not be confirmed safely. Inspect this channel before retrying.",
            });
          }
        }

        task = await application.getTask(id);
        return NextResponse.json({ task, partial, results }, { status: partial ? 207 : 200 });
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
