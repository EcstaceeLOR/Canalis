import { NextResponse } from "next/server";
import { parseActivityListQuery } from "@canalis/application";
import { apiErrorResponse } from "../../../server/api";
import { getActivityRepository } from "../../../server/activity";
import { requireWalletSession } from "../../../server/auth";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const repository = await getActivityRepository();
    await repository.synchronizeOperationalActivity(identity.walletAddress);
    const query = parseActivityListQuery(new URL(request.url));
    return NextResponse.json(await repository.list(identity.walletAddress, query));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
