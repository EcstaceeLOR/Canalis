import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody } from "../../../../server/api";
import { getWalletAuthService } from "../../../../server/auth";
import { enforcePublicRateLimit } from "../../../../server/security";

export async function POST(request: Request) {
  try {
    await enforcePublicRateLimit(request, "auth-challenge", 20, 60);
    const body = (await readJsonBody(request)) as { walletAddress?: unknown };
    const service = await getWalletAuthService();
    const challenge = await service.createChallenge(
      body.walletAddress,
      new URL(request.url).host,
    );
    return NextResponse.json(challenge, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
