import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { getCanalisApplication } from "../../../server/canalis";

export async function POST(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const body = await readJsonBody(request);
    const input = body && typeof body === "object" && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), owner: identity.walletAddress }
      : { owner: identity.walletAddress };
    const application = await getCanalisApplication();
    const created = await application.createTask(input);
    const executed = await application.executeTask(created.task.id);
    return NextResponse.json(executed, {
      headers: {
        Deprecation: "true",
        Link: '</api/tasks>; rel="successor-version"',
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
