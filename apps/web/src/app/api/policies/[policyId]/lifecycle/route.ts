import { NextResponse } from "next/server";
import { ApplicationError } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../../server/api";
import { requireWalletSession } from "../../../../../server/auth";
import { getPolicyRepository } from "../../../../../server/policies";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ policyId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { policyId } = await params;
    const body = await readJsonBody(request);
    const action = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).action
      : undefined;
    if (action !== "duplicate" && action !== "archive") {
      throw new ApplicationError("VALIDATION_ERROR", "Policy action must be duplicate or archive.", 400);
    }
    const repository = await getPolicyRepository();
    const policy = action === "duplicate"
      ? await repository.duplicate(policyId, identity.walletAddress)
      : await repository.archive(policyId, identity.walletAddress);
    return NextResponse.json({ policy }, { status: action === "duplicate" ? 201 : 200 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
