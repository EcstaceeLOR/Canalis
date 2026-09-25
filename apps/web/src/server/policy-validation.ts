import { ApplicationError, type ReusablePolicyRules } from "@canalis/application";
import { getProviderRegistryRepository } from "./providers";

export async function assertPolicyProvidersExist(
  ownerWallet: string,
  rules: ReusablePolicyRules,
): Promise<void> {
  const repository = await getProviderRegistryRepository();
  const providers = await repository.listProviders(ownerWallet);
  const known = new Set(providers.map((provider) => provider.id));
  const referenced = new Set([
    ...rules.allowedProviders,
    ...rules.blockedProviders,
    ...Object.keys(rules.providerCapsUsd),
  ]);
  const missing = [...referenced].filter((providerId) => !known.has(providerId));
  if (missing.length) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `Policy references provider${missing.length === 1 ? "" : "s"} not available to this wallet: ${missing.join(", ")}.`,
      400,
    );
  }
}
