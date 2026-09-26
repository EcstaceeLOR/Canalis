import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody } from "../../../../../server/api";
import { requireRawWalletSession } from "../../../../../server/auth";
import { inviteWorkspaceMember, workspaceDetails } from "../../../../../server/workspaces";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireRawWalletSession(request);
    const { id } = await context.params;
    const details = await workspaceDetails(id, identity.walletAddress);
    return NextResponse.json({ invitations: details.invitations });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireRawWalletSession(request);
    const { id } = await context.params;
    const invitation = await inviteWorkspaceMember(id, identity.walletAddress, await readJsonBody(request));
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
