import { NextResponse } from "next/server";
import { ApplicationError } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../server/api";
import { requireRawWalletSession } from "../../../../server/auth";
import { CANALIS_WORKSPACE_COOKIE, getWorkspaceRepository } from "../../../../server/workspaces";

export async function POST(request: Request) {
  try {
    const identity = await requireRawWalletSession(request);
    const body = await readJsonBody(request);
    const workspaceId = body && typeof body === "object" && !Array.isArray(body) && typeof (body as Record<string, unknown>).workspaceId === "string"
      ? String((body as Record<string, unknown>).workspaceId).trim()
      : "";
    if (!workspaceId || workspaceId.length > 120) {
      throw new ApplicationError("VALIDATION_ERROR", "A valid workspaceId is required.", 400);
    }
    const access = await (await getWorkspaceRepository()).getForMember(workspaceId, identity.walletAddress);
    if (!access) throw new ApplicationError("WORKSPACE_ACCESS_DENIED", "You do not have access to that workspace.", 403);
    const response = NextResponse.json({
      workspace: access.workspace,
      role: access.membership.role,
      signingWallet: access.workspace.signingWallet,
      isSigningWallet: access.workspace.signingWallet === identity.walletAddress,
    });
    response.cookies.set(CANALIS_WORKSPACE_COOKIE, workspaceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
