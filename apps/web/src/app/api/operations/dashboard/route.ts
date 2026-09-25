import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../../server/api";
import { requireWalletSession } from "../../../../server/auth";
import { getOperationsRepository } from "../../../../server/operations";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const repository = await getOperationsRepository();
    return NextResponse.json(await repository.getDashboard(identity.walletAddress));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
