import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../server/api";
import { requireRawWalletSession } from "../../../server/auth";
import { resolveWorkspaceIdentity, workspaceOverview } from "../../../server/workspaces";

export async function GET(request: Request) {
  try {
    const raw = await requireRawWalletSession(request);
    const [overview, current] = await Promise.all([
      workspaceOverview(raw.walletAddress),
      resolveWorkspaceIdentity(request, raw),
    ]);
    return NextResponse.json({
      ...overview,
      current: {
        workspaceId: current.workspaceId,
        name: current.workspaceName,
        role: current.workspaceRole,
        signingWallet: current.signingWalletAddress,
        actorWallet: current.actorWalletAddress,
        isSigningWallet: current.isSigningWallet,
        permissions: current.permissions,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
