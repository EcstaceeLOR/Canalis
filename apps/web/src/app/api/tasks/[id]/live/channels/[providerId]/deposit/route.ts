import { NextResponse } from "next/server";
import { ApplicationError } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../../../../../server/api";
import { assertWalletOwnsTask, requireWalletSession } from "../../../../../../../../server/auth";
import { getCanalisApplication } from "../../../../../../../../server/canalis";
import {
  getLiveChannelGateway,
  parsePaymentPayload,
  paymentRequiredFromChannel,
  requireLiveTask,
} from "../../../../../../../../server/live-channels";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; providerId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { id, providerId } = await params;
    const application = await getCanalisApplication();
    let task = await application.getTask(id);
    assertWalletOwnsTask(task, identity);
    requireLiveTask(task);
    const channel = task.channels.find((entry) => entry.providerId === providerId);
    if (!channel) throw new ApplicationError("CHANNEL_NOT_FOUND", "Provider channel not found.", 404);
    if (["open", "sealed", "distributed", "recovered"].includes(channel.status) && channel.openTransactionSignature) {
      return NextResponse.json({ task, idempotent: true });
    }
    if (channel.status !== "reserved") {
      throw new ApplicationError("CHANNEL_NOT_READY", `Channel ${providerId} cannot be opened from status ${channel.status}.`, 409);
    }

    const paymentRequired = paymentRequiredFromChannel(channel);
    const paymentPayload = parsePaymentPayload(await readJsonBody(request));
    const result = await getLiveChannelGateway().deposit(
      paymentPayload,
      paymentRequired.accepts[0],
      identity.walletAddress,
    );
    task = await application.recordChannelState(id, providerId, {
      status: "open",
      channelAddress: result.channelId,
      openTransactionSignature: result.transactionSignature,
      recoveryState: {
        ...(channel.recoveryState ?? {}),
        stage: "open",
        paymentRequired,
        paymentPayload: result.paymentPayload,
        expiresAtUnixSeconds: result.expiresAtUnixSeconds,
      },
    });
    return NextResponse.json({ task, channelId: result.channelId, transactionSignature: result.transactionSignature });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
