import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../../server/api";
import { assertWalletOwnsTask, requireWalletSession } from "../../../../server/auth";
import { getCanalisApplication } from "../../../../server/canalis";
import { getTaskWorkspaceRepository } from "../../../../server/tasks";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { id } = await params;
    const application = await getCanalisApplication();
    const task = await application.getTask(id);
    assertWalletOwnsTask(task, identity);
    const repository = await getTaskWorkspaceRepository();
    const workspace = await repository.getSummary(id, identity.walletAddress);
    return NextResponse.json({ ...task, workspace });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
