import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApplicationError, parseApiKeyCreate } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../server/api";
import { requireWalletSession } from "../../../../server/auth";
import { getDeveloperRepository, issueApiToken } from "../../../../server/developer";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const keys = await (await getDeveloperRepository()).listApiKeys(identity.walletAddress);
    return NextResponse.json({ keys });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const input = parseApiKeyCreate(await readJsonBody(request));
    const now = Math.floor(Date.now() / 1000);
    if (input.expiresAtUnixSeconds && input.expiresAtUnixSeconds <= now) {
      throw new ApplicationError("VALIDATION_ERROR", "API key expiry must be in the future.", 400);
    }
    const issued = issueApiToken(input.environment);
    const key = await (await getDeveloperRepository()).createApiKey({
      id: `key_${randomUUID()}`,
      ownerWallet: identity.walletAddress,
      name: input.name,
      prefix: issued.prefix,
      tokenHash: issued.hash,
      scopes: input.scopes,
      environment: input.environment,
      ...(input.expiresAtUnixSeconds ? { expiresAtUnixSeconds: input.expiresAtUnixSeconds } : {}),
    });
    return NextResponse.json({ key, token: issued.token, warning: "Copy this token now. Canalis stores only its hash and cannot show it again." }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
