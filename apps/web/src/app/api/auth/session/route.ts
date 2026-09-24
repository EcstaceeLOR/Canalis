import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody } from "../../../../server/api";
import {
  CANALIS_SESSION_COOKIE,
  getWalletAuthService,
  requireWalletSession,
  revokeWalletSession,
} from "../../../../server/auth";

const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(CANALIS_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    return NextResponse.json({ authenticated: true, ...identity });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as {
      challengeId?: unknown;
      walletAddress?: unknown;
      signatureBase64?: unknown;
    };
    const service = await getWalletAuthService();
    const { token, identity } = await service.createSession({
      challengeId: body.challengeId,
      walletAddress: body.walletAddress,
      signatureBase64: body.signatureBase64,
    });
    const response = NextResponse.json({ authenticated: true, ...identity }, { status: 201 });
    response.cookies.set(CANALIS_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await revokeWalletSession(request);
    const response = NextResponse.json({ authenticated: false });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    const response = apiErrorResponse(error);
    clearSessionCookie(response);
    return response;
  }
}
