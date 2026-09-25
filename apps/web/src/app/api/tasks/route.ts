import { NextResponse } from "next/server";
import { parseTaskListQuery, parseTaskWorkspaceCreate } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { getCanalisApplication } from "../../../server/canalis";
import { assertTaskProvidersAvailable } from "../../../server/provider-selection";
import { resolveTaskPolicy } from "../../../server/task-policy";
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
    const resolved = await resolveTaskPolicy(identity.walletAddress, input);

    await assertTaskProvidersAvailable(
      identity.walletAddress,
      resolved.rules.allowedProviders,
      input.mode,
      { requireRuntime: !input.saveAsDraft },
    );

    const application = await getCanalisApplication();
    const repository = await getTaskWorkspaceRepository();
    const task = await application.createTask({
      owner: identity.walletAddress,
      agentId: input.agentId,
      budgetUsd: resolved.rules.totalCeilingUsd,
      maxPerCallUsd: resolved.rules.maxPerCallUsd,
      expiryMinutes: resolved.rules.durationMinutes,
      allowedProviders: resolved.rules.allowedProviders,
      blockedProviders: resolved.rules.blockedProviders,
      providerCapsUsd: resolved.rules.providerCapsUsd,
      allowedNetworks: resolved.rules.allowedNetworks,
      allowedMints: resolved.rules.allowedMints,
      allowedProtocols: resolved.rules.allowedProtocols,
      ...(resolved.sourcePolicyId ? { policySourceId: resolved.sourcePolicyId } : {}),
      ...(resolved.sourcePolicyVersion ? { policySourceVersion: resolved.sourcePolicyVersion } : {}),
      policySourceName: resolved.sourcePolicyName,
      policyOverrides: resolved.overrides,
      mode: input.mode,
      initialStatus: input.saveAsDraft ? "draft" : "active",
    });
    await repository.upsertMetadata({
      taskId: task.task.id,
      name: input.name,
      description: input.description,
      policyId: resolved.sourcePolicyId ?? "inline-bounded",
    });
    const workspace = await repository.getSummary(task.task.id, identity.walletAddress);
    return NextResponse.json({ ...task, workspace }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
