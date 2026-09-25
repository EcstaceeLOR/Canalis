import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../../../server/api";
import { assertWalletOwnsTask, requireWalletSession } from "../../../../../server/auth";
import { getCanalisApplication } from "../../../../../server/canalis";
import { assertTaskProvidersAvailable } from "../../../../../server/provider-selection";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { id } = await params;
    const application = await getCanalisApplication();
    const existing = await application.getTask(id);
    assertWalletOwnsTask(existing, identity);
    await assertTaskProvidersAvailable(
      identity.walletAddress,
      existing.task.allowedProviders,
      existing.task.mode,
      { requireRuntime: true },
    );
    const task = await application.executeTask(id);
    return NextResponse.json(task);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
