import { NextResponse } from "next/server";
import { parseOperationsAnalyticsRange } from "@canalis/application";
import { apiErrorResponse } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { getOperationsRepository } from "../../../server/operations";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const range = parseOperationsAnalyticsRange(new URL(request.url));
    const repository = await getOperationsRepository();
    return NextResponse.json(await repository.getAnalytics(identity.walletAddress, range));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
