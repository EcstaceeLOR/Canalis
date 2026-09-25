import { NextResponse } from "next/server";
import {
  parseTaskListQuery,
  parseTaskWorkspaceCreate,
} from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { getCanalisApplication } from "../../../server/canalis";
import { getTaskWorkspaceRepository } from "../../../server/tasks";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const query = parseTaskListQuery(new URL(request.url), identity.walletAddress);
    const repository = await getTaskWorkspaceRepository();
    return NextResponse.json(await repository.listTasks(query));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const input = parseTaskWorkspaceCreate(await readJsonBody(request));
    const application = await getCanalisApplication();
    const repository = await getTaskWorkspaceRepository();
    const task = await application.createTask({
      owner: identity.walletAddress,
      agentId: input.agentId,
      budgetUsd: input.budgetUsd,
      maxPerCallUsd: input.maxPerCallUsd,
      expiryMinutes: input.expiryMinutes,
      allowedProviders: input.allowedProviders,
      mode: input.mode,
      initialStatus: input.saveAsDraft ? "draft" : "active",
    });
    await repository.upsertMetadata({
      taskId: task.task.id,
      name: input.name,
      description: input.description,
      policyId: input.policyId,
    });
    const workspace = await repository.getSummary(task.task.id, identity.walletAddress);
    return NextResponse.json({ ...task, workspace }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
