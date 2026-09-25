import { NextResponse } from "next/server";
import { ApplicationError, parseProviderRegistryUpdate } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../../server/api";
import { requireWalletSession } from "../../../../../server/auth";
import {
  candidateFromUpdate,
  credentialForUpdate,
  verifyIntegrationCandidate,
} from "../../../../../server/integrations";
import { sealProviderCredential } from "../../../../../server/provider-secrets";
import { getProviderRegistryRepository } from "../../../../../server/providers";
import { getSettingsRepository } from "../../../../../server/settings";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { providerId } = await params;
    const providers = await getProviderRegistryRepository();
    const current = await providers.getProvider(providerId, identity.walletAddress);
    if (!current || current.systemManaged) {
      throw new ApplicationError("PROVIDER_NOT_FOUND", "Editable integration not found.", 404);
    }

    const input = parseProviderRegistryUpdate(await readJsonBody(request));
    const settingsRepository = await getSettingsRepository();
    const settings = await settingsRepository.get(identity.walletAddress);
    const candidate = candidateFromUpdate(current, input);
    const providerCredential = await credentialForUpdate(
      providers,
      providerId,
      identity.walletAddress,
      input,
    );
    const health = await verifyIntegrationCandidate(settings, candidate, providerCredential);

    const credentialMutation = input.credential
      ? {
          kind: input.credential.kind,
          ...(input.credential.headerName ? { headerName: input.credential.headerName } : {}),
          envelope: sealProviderCredential(input.credential),
        }
      : input.clearCredential
        ? null
        : undefined;
    const provider = await providers.updateProvider(
      providerId,
      identity.walletAddress,
      input,
      credentialMutation,
    );
    const healthyProvider = await providers.recordHealth(provider.id, identity.walletAddress, health);
    return NextResponse.json({ provider: healthyProvider, health });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
