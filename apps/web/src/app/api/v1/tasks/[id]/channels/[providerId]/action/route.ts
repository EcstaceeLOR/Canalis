import {
  ApplicationError,
  channelActionFor,
  parseChannelAction,
  type TaskDetailDto,
} from "@canalis/application";
import { SOLANA_DEVNET_CAIP2 } from "@canalis/solana";
import type { PaymentPayload } from "@x402/core/types";
import { apiErrorResponse, readJsonBody } from "../../../../../../../../server/api";
import { getCanalisApplication } from "../../../../../../../../server/canalis";
import { publishWebhookEvent, requireDeveloperIdentity } from "../../../../../../../../server/developer";
import { v1Json } from "../../../../../../../../server/developer-api";
import {
  getLiveChannelGateway,
  getLiveSettlementRepository,
  paymentRequiredFromChannel,
  requireLiveTask,
} from "../../../../../../../../server/live-channels";
import { runIdempotentMutation } from "../../../../../../../../server/security";

function savedPayload(channel: TaskDetailDto["channels"][number]): PaymentPayload {
  const payload = channel.recoveryState?.paymentPayload as PaymentPayload | undefined;
  if (!payload || payload.x402Version !== 2 || !payload.payload) {
    throw new ApplicationError("LIVE_CHANNEL_OPEN_EVIDENCE_MISSING", `Provider ${channel.providerId} is missing its persisted signed open payload.`, 409);
  }
  return payload;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; providerId: string }> },
) {
  try {
    const identity = await requireDeveloperIdentity(request, ["channels:write"]);
    const { id: taskId, providerId } = await params;
    return await runIdempotentMutation({
      request,
      ownerWallet: identity.walletAddress,
      operation: "v1.channel.terminal",
      resourceKey: `channel:${taskId}:${providerId}:terminal`,
      handler: async () => {
        const action = parseChannelAction(await readJsonBody(request));
        const application = await getCanalisApplication();
        let task = await application.getTask(taskId);
        if (task.task.owner !== identity.walletAddress) throw new ApplicationError("FORBIDDEN", "This task belongs to a different wallet.", 403);
        requireLiveTask(task);
        const channel = task.channels.find((candidate) => candidate.providerId === providerId);
        if (!channel) throw new ApplicationError("CHANNEL_NOT_FOUND", "Channel not found.", 404);
        if (channel.network !== SOLANA_DEVNET_CAIP2) {
          throw new ApplicationError("CHANNEL_NETWORK_MISMATCH", "This Canalis runtime can only operate Solana devnet payment channels.", 409);
        }
        if (["distributed", "recovered"].includes(channel.status)) {
          return v1Json({ task, providerId, status: channel.status, idempotent: true });
        }
        const recoveryStage = typeof channel.recoveryState?.stage === "string" ? channel.recoveryState.stage : undefined;
        const expected = channelActionFor({
          status: channel.status,
          taskStatus: task.task.status,
          cumulativeAuthorizedAtomic: BigInt(channel.cumulativeAuthorizedAtomic),
          expiresAtUnixSeconds: BigInt(task.task.expiresAtUnixSeconds),
          nowUnixSeconds: BigInt(Math.floor(Date.now() / 1000)),
          ...(recoveryStage ? { recoveryStage } : {}),
          automaticRetryBlocked: channel.recoveryState?.automaticRetryBlocked === true,
        });
        if (expected === "inspect") {
          throw new ApplicationError("CHANNEL_RECOVERY_REQUIRED", "A previous terminal attempt may have reached Solana. Inspect and reconcile before retrying.", 409);
        }
        if (expected !== action) {
          throw new ApplicationError("CHANNEL_ACTION_NOT_ALLOWED", expected ? `This channel currently permits only the ${expected} action.` : "This channel has no safe terminal action.", 409);
        }
        const paymentRequired = paymentRequiredFromChannel(channel);
        const paymentPayload = savedPayload(channel);
        const settledAtomic = BigInt(channel.cumulativeAuthorizedAtomic);
        const settlements = getLiveSettlementRepository();
        const lease = await settlements.beginFinalization({
          taskId, providerId, cumulativeAmountAtomic: settledAtomic,
          startedAtUnixSeconds: BigInt(Math.floor(Date.now() / 1000)),
        });
        if (lease !== "acquired") {
          if (lease === "terminal") {
            task = await application.getTask(taskId);
            return v1Json({ task, providerId, idempotent: true });
          }
          throw new ApplicationError(
            lease === "busy" ? "CHANNEL_RECOVERY_REQUIRED" : "CHANNEL_ACTION_NOT_ALLOWED",
            lease === "busy" ? "Another or previous finalization attempt owns this channel. Automatic rebroadcast is blocked." : `Channel cannot begin finalization from its current state (${lease}).`,
            409,
          );
        }
        try {
          const result = await getLiveChannelGateway().claim(paymentPayload, paymentRequired.accepts[0]!, settledAtomic);
          const refundedAtomic = BigInt(result.refundedAtomic);
          const status = settledAtomic === 0n ? "recovered" : "distributed";
          task = await application.recordChannelState(taskId, providerId, {
            status,
            settleTransactionSignature: result.transactionSignature,
            distributionTransactionSignature: result.transactionSignature,
            ...(refundedAtomic > 0n ? { refundTransactionSignature: result.transactionSignature } : {}),
            recoveryState: {
              ...(channel.recoveryState ?? {}), stage: "finalized", settledAtomic: result.settledAtomic,
              refundedAtomic: result.refundedAtomic, finalizationTransactionSignature: result.transactionSignature,
            },
          });
          await settlements.recordSettlement({ taskId, providerId, cumulativeAmountAtomic: settledAtomic, transactionSignature: result.transactionSignature });
          await publishWebhookEvent(identity.walletAddress, status === "recovered" ? "channel.recovered" : "channel.finalized", {
            taskId, providerId, status, settledAtomic: result.settledAtomic, refundedAtomic: result.refundedAtomic,
            transactionSignature: result.transactionSignature,
          });
          await publishWebhookEvent(identity.walletAddress, "settlement.completed", {
            taskId, providerId, cumulativeAmountAtomic: settledAtomic.toString(), transactionSignature: result.transactionSignature,
          });
          return v1Json({ task, providerId, status, result });
        } catch (caught) {
          const errorMessage = caught instanceof Error ? caught.message : "Unknown finalization error.";
          await application.recordChannelState(taskId, providerId, {
            status: "failed",
            recoveryState: { ...(channel.recoveryState ?? {}), stage: "finalization-ambiguous", automaticRetryBlocked: true, error: errorMessage },
          });
          await publishWebhookEvent(identity.walletAddress, "settlement.failed", { taskId, providerId, code: "CHANNEL_FINALIZATION_AMBIGUOUS" });
          throw new ApplicationError(
            "CHANNEL_FINALIZATION_AMBIGUOUS",
            "The terminal transaction could not be confirmed safely. Automatic retry is blocked until the channel is reconciled.",
            502,
            { providerId },
          );
        }
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
