import { NextResponse } from "next/server";
import { ApplicationError } from "@canalis/application";
import { apiErrorResponse } from "../../../../../../server/api";
import { assertWalletOwnsTask, requireWalletSession } from "../../../../../../server/auth";
import { getCanalisApplication } from "../../../../../../server/canalis";
import { getLiveChannelGateway, requireLiveTask } from "../../../../../../server/live-channels";
import { runIdempotentMutation } from "../../../../../../server/security";

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
      operation: "task.live.prepare",
      resourceKey: `task:${id}:live-prepare`,
      handler: async () => {
        const application = await getCanalisApplication();
        let task = await application.getTask(id);
        assertWalletOwnsTask(task, identity);
        requireLiveTask(task);
        if (task.task.status !== "active") {
          throw new ApplicationError("TASK_NOT_ACTIVE", "Only active live tasks can prepare channels.", 409);
        }

        const gateway = getLiveChannelGateway();
        const tokenAccount = await gateway.fundSandboxWallet(
          identity.walletAddress,
          BigInt(task.task.budgetAtomic),
        );
        const preparations = [];

        for (const channel of task.channels) {
          if (channel.status !== "reserved") continue;
          const existing = channel.recoveryState?.paymentRequired;
          if (existing) {
            preparations.push({ providerId: channel.providerId, paymentRequired: existing });
            continue;
          }
          const prepared = await gateway.prepareChannel({
            taskId: id,
            payer: identity.walletAddress,
            providerId: channel.providerId,
            ceilingAtomic: BigInt(channel.ceilingAtomic),
            taskExpiresAtUnixSeconds: BigInt(task.task.expiresAtUnixSeconds),
          });
          task = await application.recordChannelState(id, channel.providerId, {
            recoveryState: {
              stage: "prepared",
              paymentRequired: prepared.paymentRequired,
              providerPayTo: prepared.providerPayTo,
              facilitator: prepared.facilitator,
              receiverAuthorizer: prepared.receiverAuthorizer,
              sandboxTokenAccount: tokenAccount,
            },
          });
          preparations.push({ providerId: channel.providerId, paymentRequired: prepared.paymentRequired });
        }

        return NextResponse.json({
          task,
          funding: { mint: task.task.mint, tokenAccount, amountAtomic: task.task.budgetAtomic },
          preparations,
        });
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
