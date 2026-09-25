import {
  ApplicationError,
  assertProviderSelectable,
  type ProviderMode,
  type ProviderRegistryRecord,
} from "@canalis/application";
import { getProviderRegistryRepository } from "./providers";

export type ProviderSelectionOptions = {
  requireRuntime?: boolean;
};

function modeCompatible(provider: ProviderRegistryRecord, mode: ProviderMode): boolean {
  if (provider.mode === mode) return true;
  return mode === "x402" && provider.systemManaged && provider.protocol === "demo";
}

export function providerRuntimeReady(provider: ProviderRegistryRecord, mode: ProviderMode): boolean {
  // The current non-custodial runner has three built-in provider roles. In x402
  // mode those roles are wrapped by the live Solana channel transport. External
  // x402/MPP endpoints can be configured and health-verified, but they require a
  // signer/session runtime before Canalis may execute them without custody.
  return (
    provider.systemManaged &&
    ["search", "data", "inference"].includes(provider.id) &&
    (mode === "deterministic" || mode === "x402")
  );
}

export async function assertTaskProvidersAvailable(
  ownerWallet: string,
  providerIds: readonly string[],
  mode: ProviderMode,
  options: ProviderSelectionOptions = {},
): Promise<ProviderRegistryRecord[]> {
  const repository = await getProviderRegistryRepository();
  const available = await repository.listProviders(ownerWallet);
  const byId = new Map(available.map((provider) => [provider.id, provider]));

  const selected = providerIds.map((providerId) => {
    const provider = byId.get(providerId);
    if (!provider) {
      throw new ApplicationError(
        "PROVIDER_NOT_FOUND",
        `Provider ${providerId} is not available to this wallet.`,
        404,
      );
    }
    assertProviderSelectable(provider);
    if (!modeCompatible(provider, mode)) {
      throw new ApplicationError(
        "PROVIDER_MODE_MISMATCH",
        `${provider.name} is not compatible with ${mode} tasks.`,
        409,
      );
    }
    if (options.requireRuntime && !providerRuntimeReady(provider, mode)) {
      throw new ApplicationError(
        "PROVIDER_RUNTIME_NOT_CONNECTED",
        `${provider.name} is configured and verified, but this deployment does not yet have a non-custodial ${provider.protocol.toUpperCase()} signer/session runtime connected for execution. Save the task as a draft or use a runtime-ready provider.`,
        409,
      );
    }
    return provider;
  });

  return selected;
}
