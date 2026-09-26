import { NextResponse } from "next/server";
import {
  ApplicationError,
  assertTaskCompatibleWithSettings,
  parseTaskListQuery,
  parseTaskWorkspaceCreate,
  type DeveloperIdentity,
} from "@canalis/application";
import { readJsonBody } from "./api";
import { getCanalisApplication } from "./canalis";
import { assertSandboxCompatible, publishWebhookEvent } from "./developer";
import { assertTaskProvidersAvailable } from "./provider-selection";
import { runIdempotentMutation } from "./security";
import { getSettingsRepository } from "./settings";
import { resolveTaskPolicy } from "./task-policy";
import { getTaskWorkspaceRepository } from "./tasks";

export function v1Json(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("canalis-api-version", "v1");
  headers.set("cache-control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

export async function listDeveloperTasks(request: Request, identity: DeveloperIdentity) {
  const query = parseTaskListQuery(new URL(request.url), identity.walletAddress);
  const repository = await getTaskWorkspaceRepository();
  return v1Json(await repository.listTasks(query));
}

export async function createDeveloperTask(request: Request, identity: DeveloperIdentity) {
  return runIdempotentMutation({
    request,
    ownerWallet: identity.walletAddress,
    operation: "v1.task.create",
    handler: async () => {
      const settings = await (await getSettingsRepository()).get(identity.walletAddress);
      const raw = await readJsonBody(request);
      const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const input = parseTaskWorkspaceCreate({
        ...record,
        ...(record.agentId === undefined ? { agentId: settings.taskDefaults.agentId } : {}),
        ...(record.mode === undefined ? { mode: settings.taskDefaults.executionMode } : {}),
        ...(record.policyId === undefined && settings.taskDefaults.defaultPolicyId ? { policyId: settings.taskDefaults.defaultPolicyId } : {}),
        ...(record.saveAsDraft === undefined ? { saveAsDraft: settings.taskDefaults.saveAsDraft } : {}),
      });
      assertSandboxCompatible(identity, settings.environment, input.mode);
      if (settings.environment === "mainnet") {
        throw new ApplicationError(
          "MAINNET_RUNTIME_NOT_CONFIGURED",
          "This account is configured for mainnet, but the current Canalis signer/runtime is devnet-only.",
          409,
        );
      }
      if (settings.environment === "local" && input.mode !== "deterministic") {
        throw new ApplicationError("LOCAL_RUNTIME_MODE_UNAVAILABLE", "Local workspaces currently support deterministic execution only.", 409);
      }
      const resolved = await resolveTaskPolicy(identity.walletAddress, input);
      assertTaskCompatibleWithSettings(settings, {
        mode: input.mode,
        allowedNetworks: resolved.rules.allowedNetworks,
        allowedMints: resolved.rules.allowedMints,
        allowedProtocols: resolved.rules.allowedProtocols,
      });
      await assertTaskProvidersAvailable(identity.walletAddress, resolved.rules.allowedProviders, input.mode, { requireRuntime: !input.saveAsDraft });
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
      await repository.upsertMetadata({ taskId: task.task.id, name: input.name, description: input.description, policyId: resolved.sourcePolicyId ?? "inline-bounded" });
      const workspace = await repository.getSummary(task.task.id, identity.walletAddress);
      await publishWebhookEvent(identity.walletAddress, "task.created", { taskId: task.task.id, status: task.task.status, mode: task.task.mode });
      return v1Json({ ...task, workspace }, { status: 201 });
    },
  });
}

export async function getDeveloperTask(identity: DeveloperIdentity, id: string) {
  const application = await getCanalisApplication();
  const task = await application.getTask(id);
  if (task.task.owner !== identity.walletAddress) throw new ApplicationError("FORBIDDEN", "This task belongs to a different wallet.", 403);
  const workspace = await (await getTaskWorkspaceRepository()).getSummary(id, identity.walletAddress);
  return v1Json({ ...task, workspace });
}

export async function executeDeveloperTask(request: Request, identity: DeveloperIdentity, id: string) {
  return runIdempotentMutation({
    request,
    ownerWallet: identity.walletAddress,
    operation: "v1.task.execute",
    resourceKey: `task:${id}:mutation`,
    handler: async () => {
      const application = await getCanalisApplication();
      const existing = await application.getTask(id);
      if (existing.task.owner !== identity.walletAddress) throw new ApplicationError("FORBIDDEN", "This task belongs to a different wallet.", 403);
      const settings = await (await getSettingsRepository()).get(identity.walletAddress);
      assertSandboxCompatible(identity, settings.environment, existing.task.mode);
      await assertTaskProvidersAvailable(identity.walletAddress, existing.task.allowedProviders, existing.task.mode, { requireRuntime: true });
      const task = await application.executeTask(id);
      const authorized = task.flows.filter((flow) => flow.status === "fulfilled");
      const rejected = task.flows.filter((flow) => flow.status === "rejected" || flow.status === "failed");
      await publishWebhookEvent(identity.walletAddress, "task.executed", { taskId: id, status: task.task.status, flows: task.flows.length });
      for (const flow of authorized) {
        await publishWebhookEvent(identity.walletAddress, "payment.authorized", {
          taskId: id, flowId: flow.id, providerId: flow.providerId,
          quotedAmountAtomic: flow.quotedAmountAtomic.toString(), nextCumulativeAtomic: flow.nextCumulativeAtomic.toString(),
        });
      }
      for (const flow of rejected) {
        await publishWebhookEvent(identity.walletAddress, "payment.rejected", {
          taskId: id, flowId: flow.id, providerId: flow.providerId, code: flow.rejectionCode ?? "PROVIDER_CALL_FAILED",
        });
      }
      if (task.task.status === "completed") await publishWebhookEvent(identity.walletAddress, "task.completed", { taskId: id });
      return v1Json(task);
    },
  });
}

export async function getDeveloperChannels(identity: DeveloperIdentity, id: string) {
  const application = await getCanalisApplication();
  const task = await application.getTask(id);
  if (task.task.owner !== identity.walletAddress) throw new ApplicationError("FORBIDDEN", "This task belongs to a different wallet.", 403);
  return v1Json({ taskId: id, channels: task.channels });
}

export async function getDeveloperReceipts(identity: DeveloperIdentity, id: string) {
  const application = await getCanalisApplication();
  const task = await application.getTask(id);
  if (task.task.owner !== identity.walletAddress) throw new ApplicationError("FORBIDDEN", "This task belongs to a different wallet.", 403);
  return v1Json({
    taskId: id,
    receipts: task.flows.filter((flow) => Boolean(flow.receipt)).map((flow) => ({ flowId: flow.id, providerId: flow.providerId, status: flow.status, receipt: flow.receipt })),
    settlements: task.settlements,
  });
}
