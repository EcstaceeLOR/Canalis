import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody } from "../../../../server/api";
import { requireRawWalletSession } from "../../../../server/auth";
import { renameWorkspace, workspaceDetails } from "../../../../server/workspaces";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireRawWalletSession(request);
    const { id } = await context.params;
    return NextResponse.json(await workspaceDetails(id, identity.walletAddress));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireRawWalletSession(request);
    const { id } = await context.params;
    const workspace = await renameWorkspace(id, identity.walletAddress, await readJsonBody(request));
    return NextResponse.json({ workspace });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
