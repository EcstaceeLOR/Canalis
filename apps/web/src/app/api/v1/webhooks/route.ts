import { randomUUID } from "node:crypto";
import { parseWebhookSubscriptionCreate } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../server/api";
import { assertSafeWebhookUrl, getDeveloperRepository, issueWebhookSecret, requireDeveloperIdentity } from "../../../../server/developer";
import { v1Json } from "../../../../server/developer-api";

export async function GET(request: Request) {
  try {
    const identity = await requireDeveloperIdentity(request, ["webhooks:read"]);
    const repository = await getDeveloperRepository();
    const [subscriptions, deliveries] = await Promise.all([
      repository.listWebhooks(identity.walletAddress),
      repository.listDeliveries(identity.walletAddress, undefined, 100),
    ]);
    return v1Json({ subscriptions, deliveries });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireDeveloperIdentity(request, ["webhooks:write"]);
    const input = parseWebhookSubscriptionCreate(await readJsonBody(request));
    await assertSafeWebhookUrl(input.url);
    const issued = issueWebhookSecret();
    const subscription = await (await getDeveloperRepository()).createWebhook({
      id: `wh_${randomUUID()}`,
      ownerWallet: identity.walletAddress,
      url: input.url,
      description: input.description,
      events: input.events,
      secretEnvelope: issued.envelope,
    });
    return v1Json({
      subscription,
      secret: issued.secret,
      signing: "HMAC-SHA256 over `${Canalis-Timestamp}.${rawBody}`; compare to Canalis-Signature v1=<hex>.",
    }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
