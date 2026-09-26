import { ApplicationError } from "@canalis/application";
import { apiErrorResponse } from "../../../../../../server/api";
import { getDeveloperRepository, issueWebhookSecret, requireDeveloperIdentity } from "../../../../../../server/developer";
import { v1Json } from "../../../../../../server/developer-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireDeveloperIdentity(request, ["webhooks:write"]);
    const { id } = await params;
    const issued = issueWebhookSecret();
    const rotated = await (await getDeveloperRepository()).rotateWebhookSecret(id, identity.walletAddress, issued.envelope);
    if (!rotated) throw new ApplicationError("WEBHOOK_NOT_FOUND", "Webhook subscription not found.", 404);
    return v1Json({ id, secret: issued.secret });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
