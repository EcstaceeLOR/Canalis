import { NextResponse } from "next/server";
import { ApplicationError, parseAccountSettings } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { getPolicyRepository } from "../../../server/policies";
import { getSettingsRepository } from "../../../server/settings";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const repository = await getSettingsRepository();
    return NextResponse.json({ settings: await repository.get(identity.walletAddress) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const settings = parseAccountSettings(await readJsonBody(request), identity.walletAddress);

    if (settings.taskDefaults.defaultPolicyId) {
      const policies = await getPolicyRepository();
      const policy = await policies.get(settings.taskDefaults.defaultPolicyId, identity.walletAddress);
      if (!policy || policy.status !== "active") {
        throw new ApplicationError(
          "DEFAULT_POLICY_INVALID",
          "The selected default policy does not exist, is archived, or belongs to another wallet.",
          409,
        );
      }
    }

    const repository = await getSettingsRepository();
    return NextResponse.json({ settings: await repository.save(settings) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
