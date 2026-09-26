import { NextResponse } from "next/server";
import { normalizeWalletAddress } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../../../server/api";
import { requireRawWalletSession } from "../../../../../../server/auth";
import { removeWorkspaceMember, updateWorkspaceMemberRole } from "../../../../../../server/workspaces";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; wallet: string }> }) {
  try {
    const identity = await requireRawWalletSession(request);
    const { id, wallet } = await context.params;
    const member = await updateWorkspaceMemberRole(id, normalizeWalletAddress(wallet), identity.walletAddress, await readJsonBody(request));
    return NextResponse.json({ member });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; wallet: string }> }) {
  try {
    const identity = await requireRawWalletSession(request);
    const { id, wallet } = await context.params;
    await removeWorkspaceMember(id, normalizeWalletAddress(wallet), identity.walletAddress);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
