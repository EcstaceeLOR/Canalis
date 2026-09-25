import {
  ApplicationError,
  assertIntegrationCompatible,
  providerModeForProtocol,
  type AccountSettings,
  type ProviderCredentialInput,
  type ProviderHealthResult,
  type ProviderRegistryCreateInput,
  type ProviderRegistryRecord,
  type ProviderRegistryUpdateInput,
} from "@canalis/application";
import type { PostgresProviderRegistryRepository } from "@canalis/persistence";
import { verifyProviderHealth, type ProviderHealthCredential } from "./provider-health";
import { openProviderCredential } from "./provider-secrets";

function credential(input?: ProviderCredentialInput): ProviderHealthCredential | undefined {
  if (!input) return undefined;
  return {
    kind: input.kind,
    secret: input.secret,
    ...(input.headerName ? { headerName: input.headerName } : {}),
  };
}

export function candidateFromCreate(input: ProviderRegistryCreateInput): ProviderRegistryRecord {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    protocol: input.protocol,
    mode: providerModeForProtocol(input.protocol),
    ...(input.endpoint ? { endpoint: input.endpoint } : {}),
    payee: input.payee,
    systemManaged: false,
    status: "active",
    healthStatus: "unknown",
    supportedNetworks: input.supportedNetworks,
    supportedAssets: input.supportedAssets,
    pricingModel: input.pricingModel,
    policyMetadata: input.policyMetadata,
    hasCredential: Boolean(input.credential),
    ...(input.credential ? { credentialKind: input.credential.kind } : {}),
    ...(input.credential?.headerName ? { credentialHeaderName: input.credential.headerName } : {}),
    createdAtUnixSeconds: "0",
    updatedAtUnixSeconds: "0",
    usage: { tasks: 0, channels: 0, flows: 0 },
  };
}

export function candidateFromUpdate(
  current: ProviderRegistryRecord,
  input: ProviderRegistryUpdateInput,
): ProviderRegistryRecord {
  const candidate: ProviderRegistryRecord = {
    ...current,
    name: input.name ?? current.name,
    description: input.description ?? current.description,
    payee: input.payee ?? current.payee,
    supportedNetworks: input.supportedNetworks ?? current.supportedNetworks,
    supportedAssets: input.supportedAssets ?? current.supportedAssets,
    pricingModel: input.pricingModel ?? current.pricingModel,
    policyMetadata: input.policyMetadata ?? current.policyMetadata,
    hasCredential: input.clearCredential ? false : input.credential ? true : current.hasCredential,
  };
  if (input.endpoint === null) delete candidate.endpoint;
  else if (input.endpoint !== undefined) candidate.endpoint = input.endpoint;
  if (input.clearCredential) {
    delete candidate.credentialKind;
    delete candidate.credentialHeaderName;
  } else if (input.credential) {
    candidate.credentialKind = input.credential.kind;
    if (input.credential.headerName) candidate.credentialHeaderName = input.credential.headerName;
    else delete candidate.credentialHeaderName;
  }
  return candidate;
}

export async function credentialForUpdate(
  repository: PostgresProviderRegistryRepository,
  providerId: string,
  ownerWallet: string,
  input: ProviderRegistryUpdateInput,
): Promise<ProviderHealthCredential | undefined> {
  if (input.clearCredential) return undefined;
  if (input.credential) return credential(input.credential);
  const stored = await repository.getSecretEnvelope(providerId, ownerWallet);
  if (!stored) return undefined;
  return {
    kind: stored.kind,
    secret: openProviderCredential(stored.envelope),
    ...(stored.headerName ? { headerName: stored.headerName } : {}),
  };
}

export async function verifyIntegrationCandidate(
  settings: AccountSettings,
  candidate: ProviderRegistryRecord,
  providerCredential?: ProviderHealthCredential,
): Promise<ProviderHealthResult> {
  if (candidate.protocol === "demo") {
    throw new ApplicationError(
      "INTEGRATION_PROTOCOL_UNSUPPORTED",
      "Settings integrations are for external x402 or MPP adapters. Built-in deterministic providers are system-managed.",
      400,
    );
  }
  assertIntegrationCompatible(settings, candidate);
  const health = await verifyProviderHealth(candidate, providerCredential);
  if (health.status !== "healthy") {
    throw new ApplicationError(
      "INTEGRATION_CONNECTION_FAILED",
      `Integration was not saved because the connection test failed: ${health.message}`,
      409,
      { health },
    );
  }
  return health;
}

export function credentialForCreate(input: ProviderRegistryCreateInput): ProviderHealthCredential | undefined {
  return credential(input.credential);
}
