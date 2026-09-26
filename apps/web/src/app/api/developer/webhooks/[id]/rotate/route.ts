import { NextResponse } from "next/server";
import { ApplicationError } from "@canalis/application";
import { apiErrorResponse } from "../../../../../../server/api";
import { requireWalletSession } from "../../../../../../server/auth";
import { getDeveloperRepository, issueWebhookSecret } from "../../../../../../server/developer";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireWalletSession(request);
    const { id } = await params;
    const issued = issueWebhookSecret();
    const rotated = await (await getDeveloperRepository()).rotateWebhookSecret(id, identity.walletAddress, issued.envelope);
    if (!rotated) throw new ApplicationError("WEBHOOK_NOT_FOUND", "Webhook subscription not found.", 404);
    return NextResponse.json({ id, secret: issued.secret, warning: "The previous signing secret is invalid immediately. Copy this replacement now." });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
