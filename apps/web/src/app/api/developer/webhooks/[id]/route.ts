import { NextResponse } from "next/server";
import { ApplicationError, parseWebhookSubscriptionUpdate } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../../server/api";
import { requireWalletSession } from "../../../../../server/auth";
import { assertSafeWebhookUrl, getDeveloperRepository } from "../../../../../server/developer";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireWalletSession(request);
    const { id } = await params;
    const input = parseWebhookSubscriptionUpdate(await readJsonBody(request));
    if (input.url) await assertSafeWebhookUrl(input.url);
    const subscription = await (await getDeveloperRepository()).updateWebhook({ id, ownerWallet: identity.walletAddress, ...input });
    if (!subscription) throw new ApplicationError("WEBHOOK_NOT_FOUND", "Webhook subscription not found.", 404);
    return NextResponse.json({ subscription });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
