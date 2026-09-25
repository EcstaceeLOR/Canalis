import { NextResponse } from "next/server";
import { ApplicationError, assertTaskCompatibleWithSettings, parseTaskListQuery, parseTaskWorkspaceCreate } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { getCanalisApplication } from "../../../server/canalis";
import { assertTaskProvidersAvailable } from "../../../server/provider-selection";
import { resolveTaskPolicy } from "../../../server/task-policy";
import { getSettingsRepository } from "../../../server/settings";
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
    const settingsRepository = await getSettingsRepository();
    const settings = await settingsRepository.get(identity.walletAddress);
    const raw = await readJsonBody(request);
    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const input = parseTaskWorkspaceCreate({
      ...record,
      ...(record.agentId === undefined ? { agentId: settings.taskDefaults.agentId } : {}),
      ...(record.mode === undefined ? { mode: settings.taskDefaults.executionMode } : {}),
      ...(record.policyId === undefined && settings.taskDefaults.defaultPolicyId ? { policyId: settings.taskDefaults.defaultPolicyId } : {}),
      ...(record.saveAsDraft === undefined ? { saveAsDraft: settings.taskDefaults.saveAsDraft } : {}),
    });

    if (settings.environment === "mainnet") {
      throw new ApplicationError(
        "MAINNET_RUNTIME_NOT_CONFIGURED",
        "This account is configured for mainnet, but the current Canalis payment-channel signer/runtime is devnet-only. Task creation is blocked to prevent accidental devnet execution under a mainnet profile.",
        409,
      );
    }
    if (settings.environment === "local" && input.mode !== "deterministic") {
      throw new ApplicationError(
        "LOCAL_RUNTIME_MODE_UNAVAILABLE",
        "Local workspaces currently support deterministic execution only. Switch to devnet for x402/MPP integration execution.",
        409,
      );
    }

    const resolved = await resolveTaskPolicy(identity.walletAddress, input);
    assertTaskCompatibleWithSettings(settings, {
      mode: input.mode,
      allowedNetworks: resolved.rules.allowedNetworks,
      allowedMints: resolved.rules.allowedMints,
      allowedProtocols: resolved.rules.allowedProtocols,
    });

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
