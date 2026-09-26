import { apiErrorResponse } from "../../../../../../../server/api";
import { requireDeveloperIdentity, retryWebhookDelivery } from "../../../../../../../server/developer";
import { v1Json } from "../../../../../../../server/developer-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireDeveloperIdentity(request, ["webhooks:write"]);
    const { id } = await params;
    return v1Json(await retryWebhookDelivery(identity.walletAddress, id));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
