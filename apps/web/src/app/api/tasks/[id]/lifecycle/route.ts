import { NextResponse } from "next/server";
import { ApplicationError, parseTaskLifecycle } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../../server/api";
import { assertWalletOwnsTask, requireWalletSession } from "../../../../../server/auth";
import { getCanalisApplication } from "../../../../../server/canalis";
import { assertTaskProvidersAvailable } from "../../../../../server/provider-selection";
import { getTaskWorkspaceRepository } from "../../../../../server/tasks";

function atomicToUsd(value: string) {
  const atomic = BigInt(value);
  const whole = atomic / 1_000_000n;
  const fractional = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole.toString();
}

function assertTransition(current: string, allowed: readonly string[], action: string) {
  if (!allowed.includes(current)) {
    throw new ApplicationError(
      "INVALID_TASK_TRANSITION",
      `Cannot ${action} a task while it is ${current}.`,
      409,
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { id } = await params;
    const action = parseTaskLifecycle(await readJsonBody(request));
    const application = await getCanalisApplication();
    const repository = await getTaskWorkspaceRepository();
    const existing = await application.getTask(id);
    assertWalletOwnsTask(existing, identity);
    const workspace = await repository.getSummary(id, identity.walletAddress);
    if (!workspace) throw new ApplicationError("TASK_NOT_FOUND", "Task not found.", 404);

    const durationSeconds = BigInt(existing.task.expiresAtUnixSeconds) - BigInt(existing.task.createdAtUnixSeconds);

    if (action === "submit" || action === "cancel" || action === "archive") {
      const allowed = action === "submit"
        ? ["draft"]
        : action === "cancel"
          ? ["draft", "active"]
          : ["draft", "completed", "cancelled"];
      assertTransition(existing.task.status, allowed, action);
      if (action === "submit") {
        await assertTaskProvidersAvailable(
          identity.walletAddress,
          existing.task.allowedProviders,
          existing.task.mode,
          { requireRuntime: true },
        );
      }
      const nextStatus = action === "submit" ? "active" : action === "cancel" ? "cancelled" : "archived";
      const now = BigInt(Math.floor(Date.now() / 1000));
      await repository.setStatus(
        id,
        identity.walletAddress,
        nextStatus,
        now,
        action === "submit" ? now + durationSeconds : undefined,
      );
      const task = await application.getTask(id);
      const nextWorkspace = await repository.getSummary(id, identity.walletAddress);
      return NextResponse.json({ ...task, workspace: nextWorkspace });
    }

    if (action === "rerun") {
      assertTransition(existing.task.status, ["completed", "cancelled", "archived"], action);
      await assertTaskProvidersAvailable(
        identity.walletAddress,
        existing.task.allowedProviders,
        existing.task.mode,
        { requireRuntime: true },
      );
    }

    const expiryMinutes = Math.max(1, Math.min(10_080, Number(durationSeconds / 60n)));
    const providerCapsUsd = Object.fromEntries(
      Object.entries(existing.task.providerCapsAtomic).map(([providerId, atomic]) => [providerId, atomicToUsd(atomic)]),
    );
    const created = await application.createTask({
      owner: identity.walletAddress,
      agentId: existing.task.agentId,
      budgetUsd: atomicToUsd(existing.task.budgetAtomic),
      maxPerCallUsd: atomicToUsd(existing.task.maxPerCallAtomic ?? existing.task.budgetAtomic),
      expiryMinutes,
      allowedProviders: existing.task.allowedProviders,
      blockedProviders: existing.task.blockedProviders,
      providerCapsUsd,
      allowedNetworks: existing.task.allowedNetworks,
      allowedMints: existing.task.allowedMints,
      allowedProtocols: existing.task.allowedProtocols.length ? existing.task.allowedProtocols : [existing.task.mode === "deterministic" ? "demo" : existing.task.mode],
      ...(existing.task.policySourceId ? { policySourceId: existing.task.policySourceId } : {}),
      ...(existing.task.policySourceVersion ? { policySourceVersion: existing.task.policySourceVersion } : {}),
      policySourceName: existing.task.policySourceName ?? "Inline bounded policy",
      policyOverrides: existing.task.policyOverrides,
      mode: existing.task.mode,
      initialStatus: action === "rerun" ? "active" : "draft",
    });
    const suffix = action === "rerun" ? "rerun" : "copy";
    await repository.upsertMetadata({
      taskId: created.task.id,
      name: `${workspace.name} · ${suffix}`.slice(0, 120),
      description: workspace.description,
      policyId: existing.task.policySourceId ?? "inline-bounded",
    });
    const createdWorkspace = await repository.getSummary(created.task.id, identity.walletAddress);
    return NextResponse.json({ ...created, workspace: createdWorkspace }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
