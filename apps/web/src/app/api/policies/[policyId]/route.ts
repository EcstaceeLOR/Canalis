import { NextResponse } from "next/server";
import { ApplicationError, parseReusablePolicyUpdate } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../server/api";
import { requireWalletSession } from "../../../../server/auth";
import { getPolicyRepository } from "../../../../server/policies";
import { assertPolicyProvidersExist } from "../../../../server/policy-validation";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ policyId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { policyId } = await params;
    const versionRaw = new URL(request.url).searchParams.get("version");
    const version = versionRaw ? Number.parseInt(versionRaw, 10) : undefined;
    if (versionRaw && (!version || version < 1)) {
      throw new ApplicationError("VALIDATION_ERROR", "Policy version must be a positive integer.", 400);
    }
    const repository = await getPolicyRepository();
    const policy = await repository.get(policyId, identity.walletAddress, version);
    if (!policy) throw new ApplicationError("POLICY_NOT_FOUND", "Policy or version not found.", 404);
    return NextResponse.json({ policy });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ policyId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { policyId } = await params;
    const input = parseReusablePolicyUpdate(await readJsonBody(request));
    if (input.rules) await assertPolicyProvidersExist(identity.walletAddress, input.rules);
    const repository = await getPolicyRepository();
    const policy = await repository.update(policyId, identity.walletAddress, input);
    return NextResponse.json({ policy });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
