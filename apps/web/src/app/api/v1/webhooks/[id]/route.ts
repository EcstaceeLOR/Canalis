import { ApplicationError, parseWebhookSubscriptionUpdate } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../../server/api";
import { assertSafeWebhookUrl, getDeveloperRepository, requireDeveloperIdentity } from "../../../../../server/developer";
import { v1Json } from "../../../../../server/developer-api";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireDeveloperIdentity(request, ["webhooks:write"]);
    const { id } = await params;
    const input = parseWebhookSubscriptionUpdate(await readJsonBody(request));
    if (input.url) await assertSafeWebhookUrl(input.url);
    const subscription = await (await getDeveloperRepository()).updateWebhook({ id, ownerWallet: identity.walletAddress, ...input });
    if (!subscription) throw new ApplicationError("WEBHOOK_NOT_FOUND", "Webhook subscription not found.", 404);
    return v1Json({ subscription });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
