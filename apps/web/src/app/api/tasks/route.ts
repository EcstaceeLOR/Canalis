import { NextResponse } from "next/server";
import {
  ApplicationError,
  assertProviderSelectable,
  parseTaskListQuery,
  parseTaskWorkspaceCreate,
} from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { getCanalisApplication } from "../../../server/canalis";
import { getProviderRegistryRepository } from "../../../server/providers";
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
    const providerRepository = await getProviderRegistryRepository();
    const availableProviders = await providerRepository.listProviders(identity.walletAddress);
    const byId = new Map(availableProviders.map((provider) => [provider.id, provider]));
    const selectedProviders = input.allowedProviders.map((providerId) => {
      const provider = byId.get(providerId);
      if (!provider) {
        throw new ApplicationError(
          "PROVIDER_NOT_FOUND",
          `Provider ${providerId} is not available to this wallet.`,
          404,
        );
      }
      assertProviderSelectable(provider);
      return provider;
    });

    const incompatible = selectedProviders.filter(
      (provider) =>
        provider.mode !== input.mode &&
        !(input.mode === "x402" && provider.systemManaged && provider.protocol === "demo"),
    );
    if (incompatible.length > 0) {
      throw new ApplicationError(
        "PROVIDER_MODE_MISMATCH",
        `Selected providers are not compatible with ${input.mode} tasks: ${incompatible.map((provider) => provider.name).join(", ")}.`,
        409,
      );
    }

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
