import { NextResponse } from "next/server";
import { apiErrorResponse } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { buildOnboardingProgress } from "../../../server/onboarding";
import { providerRuntimeReady } from "../../../server/provider-selection";
import { getProviderRegistryRepository } from "../../../server/providers";
import { getPolicyRepository } from "../../../server/policies";
import { getSettingsRepository } from "../../../server/settings";
import { getTaskWorkspaceRepository } from "../../../server/tasks";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const owner = identity.walletAddress;

    const providerRepository = await getProviderRegistryRepository();
    const policyRepository = await getPolicyRepository();
    const settingsRepository = await getSettingsRepository();
    const taskRepository = await getTaskWorkspaceRepository();

    const [providers, policies, settings, tasks] = await Promise.all([
      providerRepository.listProviders(owner),
      policyRepository.list(owner, false),
      settingsRepository.get(owner),
      taskRepository.listTasks({ owner, sort: "updated_desc", page: 1, pageSize: 1 }),
    ]);

    const runtimeReadyProviders = providers.filter((provider) =>
      provider.status === "active"
      && provider.healthStatus !== "unhealthy"
      && providerRuntimeReady(provider, provider.mode),
    ).length;
    const customProviders = providers.filter((provider) => !provider.systemManaged).length;
    const verifiedExternalProviders = providers.filter((provider) =>
      !provider.systemManaged && provider.healthStatus === "healthy",
    ).length;
    const inventory = {
      runtimeReadyProviders,
      customProviders,
      verifiedExternalProviders,
      policies: policies.length,
      tasks: tasks.total,
    };

    return NextResponse.json({
      progress: buildOnboardingProgress(inventory),
      inventory,
      runtime: {
        environment: settings.environment,
        solanaNetwork: settings.solanaNetwork,
        defaultAssetSymbol: settings.defaultAssetSymbol,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
