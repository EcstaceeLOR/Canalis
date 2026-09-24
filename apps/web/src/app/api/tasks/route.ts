import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { getCanalisApplication } from "../../../server/canalis";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 50, 100));
    const application = await getCanalisApplication();
    const tasks = await application.listTasks(100);
    const ownedTasks = tasks
      .filter((task) => task.task.owner === identity.walletAddress)
      .slice(0, limit);
    return NextResponse.json({ tasks: ownedTasks });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const body = await readJsonBody(request);
    const input = body && typeof body === "object" && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), owner: identity.walletAddress }
      : { owner: identity.walletAddress };
    const application = await getCanalisApplication();
    const task = await application.createTask(input);
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
