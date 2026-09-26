import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../../../../server/api";
import { requireRawWalletSession } from "../../../../../../server/auth";
import { revokeWorkspaceInvitation } from "../../../../../../server/workspaces";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; invitationId: string }> }) {
  try {
    const identity = await requireRawWalletSession(request);
    const { id, invitationId } = await context.params;
    await revokeWorkspaceInvitation(id, invitationId, identity.walletAddress);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
