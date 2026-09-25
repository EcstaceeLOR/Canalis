import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../../server/api";
import { getActivityRepository } from "../../../../server/activity";
import { requireWalletSession } from "../../../../server/auth";

export async function POST(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const repository = await getActivityRepository();
    const updated = await repository.markAllRead(identity.walletAddress);
    return NextResponse.json({ updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
