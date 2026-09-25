import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../../../server/api";
import { assertWalletOwnsTask, requireWalletSession } from "../../../../../server/auth";
import { getCanalisApplication } from "../../../../../server/canalis";
import { assertTaskProvidersAvailable } from "../../../../../server/provider-selection";
import { runIdempotentMutation } from "../../../../../server/security";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { id } = await params;
    return await runIdempotentMutation({
      request,
      ownerWallet: identity.walletAddress,
      operation: "task.execute",
      resourceKey: `task:${id}:execution`,
      handler: async () => {
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
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
