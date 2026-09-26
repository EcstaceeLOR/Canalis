import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../../../../../server/api";
import { requireWalletSession } from "../../../../../../../server/auth";
import { retryWebhookDelivery } from "../../../../../../../server/developer";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireWalletSession(request);
    const { id } = await params;
    return NextResponse.json(await retryWebhookDelivery(identity.walletAddress, id));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
