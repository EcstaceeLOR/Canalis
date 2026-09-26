import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../../../../server/api";
import { requireRawWalletSession } from "../../../../../../server/auth";
import { acceptWorkspaceInvitation } from "../../../../../../server/workspaces";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireRawWalletSession(request);
    const { id } = await context.params;
    const membership = await acceptWorkspaceInvitation(id, identity.walletAddress);
    return NextResponse.json({ membership });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
