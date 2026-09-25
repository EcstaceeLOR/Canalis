import { NextResponse } from "next/server";
import { ApplicationError, channelActionFor } from "@canalis/application";
import { apiErrorResponse } from "../../../../../server/api";
import { assertWalletOwnsTask, requireWalletSession } from "../../../../../server/auth";
import { getCanalisApplication } from "../../../../../server/canalis";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string; providerId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { taskId, providerId } = await params;
    const application = await getCanalisApplication();
    const task = await application.getTask(taskId);
    assertWalletOwnsTask(task, identity);
    const channel = task.channels.find((candidate) => candidate.providerId === providerId);
    if (!channel) throw new ApplicationError("CHANNEL_NOT_FOUND", "Channel not found.", 404);

    const recoveryStage = typeof channel.recoveryState?.stage === "string" ? channel.recoveryState.stage : undefined;
    const automaticRetryBlocked = channel.recoveryState?.automaticRetryBlocked === true;
    const nextAction = channelActionFor({
      status: channel.status,
      taskStatus: task.task.status,
      cumulativeAuthorizedAtomic: BigInt(channel.cumulativeAuthorizedAtomic),
      expiresAtUnixSeconds: BigInt(task.task.expiresAtUnixSeconds),
      nowUnixSeconds: BigInt(Math.floor(Date.now() / 1000)),
      ...(recoveryStage ? { recoveryStage } : {}),
      automaticRetryBlocked,
    });
    const ceiling = BigInt(channel.ceilingAtomic);
    const authorized = BigInt(channel.cumulativeAuthorizedAtomic);
    const terminal = ["distributed", "recovered"].includes(channel.status);

    return NextResponse.json({
      task: task.task,
      channel,
      accounting: {
        ceilingAtomic: ceiling.toString(),
        authorizedAtomic: authorized.toString(),
        recoverableAtomic: (ceiling > authorized ? ceiling - authorized : 0n).toString(),
        remainingEscrowAtomic: (terminal ? 0n : ceiling > authorized ? ceiling - authorized : 0n).toString(),
        reconciled: terminal,
      },
      vouchers: task.graph.flows
        .filter((flow) => flow.providerId === providerId)
        .map((flow) => ({
          id: flow.id,
          requestId: flow.requestId,
          status: flow.status,
          previousCumulativeAtomic: flow.previousCumulativeAtomic,
          nextCumulativeAtomic: flow.nextCumulativeAtomic,
          quotedAmountAtomic: flow.quotedAmountAtomic,
          authorizationId: flow.authorizationId,
          paymentReference: flow.paymentReference,
          responseHash: flow.receipt?.responseHash,
          createdAtUnixSeconds: flow.createdAtUnixSeconds,
        })),
      settlements: task.graph.settlements.filter((settlement) => settlement.providerId === providerId),
      recovery: {
        stage: recoveryStage ?? null,
        required: channel.status === "failed" || automaticRetryBlocked || recoveryStage === "finalization-ambiguous" || recoveryStage === "finalization-started",
        automaticRetryBlocked,
        state: channel.recoveryState ?? null,
      },
      nextAction,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
