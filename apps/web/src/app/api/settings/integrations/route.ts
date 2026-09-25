import { NextResponse } from "next/server";
import { parseProviderRegistryCreate } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../server/api";
import { requireWalletSession } from "../../../../server/auth";
import {
  candidateFromCreate,
  credentialForCreate,
  verifyIntegrationCandidate,
} from "../../../../server/integrations";
import { sealProviderCredential } from "../../../../server/provider-secrets";
import { getProviderRegistryRepository } from "../../../../server/providers";
import { getSettingsRepository } from "../../../../server/settings";

export async function POST(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const input = parseProviderRegistryCreate(await readJsonBody(request));
    const settingsRepository = await getSettingsRepository();
    const settings = await settingsRepository.get(identity.walletAddress);
    const candidate = candidateFromCreate(input);
    const health = await verifyIntegrationCandidate(settings, candidate, credentialForCreate(input));

    const providers = await getProviderRegistryRepository();
    const sealed = input.credential
      ? {
          kind: input.credential.kind,
          ...(input.credential.headerName ? { headerName: input.credential.headerName } : {}),
          envelope: sealProviderCredential(input.credential),
        }
      : undefined;
    const provider = await providers.createProvider(identity.walletAddress, input, sealed);
    const healthyProvider = await providers.recordHealth(provider.id, identity.walletAddress, health);
    return NextResponse.json({ provider: healthyProvider, health }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
