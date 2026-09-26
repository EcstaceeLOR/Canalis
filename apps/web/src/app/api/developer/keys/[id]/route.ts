import { NextResponse } from "next/server";
import { ApplicationError } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../../server/api";
import { requireWalletSession } from "../../../../../server/auth";
import { getDeveloperRepository, issueApiToken } from "../../../../../server/developer";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireWalletSession(request);
    const { id } = await params;
    const body = await readJsonBody(request);
    const action = body && typeof body === "object" && !Array.isArray(body) ? String((body as Record<string, unknown>).action ?? "") : "";
    const repository = await getDeveloperRepository();
    const existing = (await repository.listApiKeys(identity.walletAddress)).find((key) => key.id === id);
    if (!existing) throw new ApplicationError("API_KEY_NOT_FOUND", "API key not found.", 404);
    if (action === "revoke") {
      await repository.revokeApiKey(id, identity.walletAddress);
      return NextResponse.json({ id, status: "revoked" });
    }
    if (action === "rotate") {
      const issued = issueApiToken(existing.environment);
      const key = await repository.rotateApiKey({ id, ownerWallet: identity.walletAddress, prefix: issued.prefix, tokenHash: issued.hash });
      if (!key) throw new ApplicationError("API_KEY_NOT_FOUND", "API key not found.", 404);
      return NextResponse.json({ key, token: issued.token, warning: "The previous token is invalid immediately. Copy this replacement now." });
    }
    throw new ApplicationError("VALIDATION_ERROR", "Action must be rotate or revoke.", 400);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
