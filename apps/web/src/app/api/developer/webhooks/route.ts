import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { parseWebhookSubscriptionCreate } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../server/api";
import { requireWalletSession } from "../../../../server/auth";
import { assertSafeWebhookUrl, getDeveloperRepository, issueWebhookSecret } from "../../../../server/developer";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const repository = await getDeveloperRepository();
    const [subscriptions, deliveries] = await Promise.all([
      repository.listWebhooks(identity.walletAddress),
      repository.listDeliveries(identity.walletAddress, undefined, 100),
    ]);
    return NextResponse.json({ subscriptions, deliveries });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireWalletSession(request);
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
    return NextResponse.json({
      subscription,
      secret: issued.secret,
      signing: "HMAC-SHA256 over `${Canalis-Timestamp}.${rawBody}`; compare against Canalis-Signature v1=<hex>.",
      warning: "Copy this signing secret now. Canalis does not return it again unless you rotate it.",
    }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
