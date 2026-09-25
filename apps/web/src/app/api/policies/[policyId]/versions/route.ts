import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../../../server/api";
import { requireWalletSession } from "../../../../../server/auth";
import { getPolicyRepository } from "../../../../../server/policies";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ policyId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { policyId } = await params;
    const repository = await getPolicyRepository();
    return NextResponse.json({ versions: await repository.listVersions(policyId, identity.walletAddress) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
