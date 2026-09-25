import { NextResponse } from "next/server";
import {
  ApplicationError,
  parseProviderRegistryCreate,
  parseProviderRegistryUpdate,
} from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../../server/api";
import { requireWalletSession } from "../../../../../server/auth";
import {
  candidateFromCreate,
  candidateFromUpdate,
  credentialForCreate,
  credentialForUpdate,
  verifyIntegrationCandidate,
} from "../../../../../server/integrations";
import { getProviderRegistryRepository } from "../../../../../server/providers";
import { getSettingsRepository } from "../../../../../server/settings";

export async function POST(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApplicationError("VALIDATION_ERROR", "Integration test payload must be an object.", 400);
    }
    const record = body as Record<string, unknown>;
    const settingsRepository = await getSettingsRepository();
    const settings = await settingsRepository.get(identity.walletAddress);
    const providers = await getProviderRegistryRepository();

    if (typeof record.providerId === "string" && record.providerId.trim()) {
      const current = await providers.getProvider(record.providerId, identity.walletAddress);
      if (!current || current.systemManaged) {
        throw new ApplicationError("PROVIDER_NOT_FOUND", "Editable integration not found.", 404);
      }
      const input = parseProviderRegistryUpdate(record.config);
      const candidate = candidateFromUpdate(current, input);
      const providerCredential = await credentialForUpdate(
        providers,
        current.id,
        identity.walletAddress,
        input,
      );
      const health = await verifyIntegrationCandidate(settings, candidate, providerCredential);
      return NextResponse.json({
        health,
        candidate: {
          id: candidate.id,
          name: candidate.name,
          protocol: candidate.protocol,
          endpoint: candidate.endpoint,
          supportedNetworks: candidate.supportedNetworks,
          supportedAssets: candidate.supportedAssets,
          credentialConfigured: Boolean(providerCredential),
        },
      });
    }

    const input = parseProviderRegistryCreate(record.config);
    const candidate = candidateFromCreate(input);
    const health = await verifyIntegrationCandidate(settings, candidate, credentialForCreate(input));
    return NextResponse.json({
      health,
      candidate: {
        id: candidate.id,
        name: candidate.name,
        protocol: candidate.protocol,
        endpoint: candidate.endpoint,
        supportedNetworks: candidate.supportedNetworks,
        supportedAssets: candidate.supportedAssets,
        credentialConfigured: Boolean(input.credential),
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
