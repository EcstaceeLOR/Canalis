import { NextResponse } from "next/server";
import { ApplicationError } from "@canalis/application";
import { apiErrorResponse } from "../../../../../server/api";
import { requireWalletSession } from "../../../../../server/auth";
import { verifyProviderHealth } from "../../../../../server/provider-health";
import { openProviderCredential } from "../../../../../server/provider-secrets";
import { getProviderRegistryRepository } from "../../../../../server/providers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { providerId } = await params;
    const repository = await getProviderRegistryRepository();
    const provider = await repository.getProvider(providerId, identity.walletAddress);
    if (!provider) throw new ApplicationError("PROVIDER_NOT_FOUND", "Provider not found.", 404);

    const storedCredential = provider.systemManaged
      ? null
      : await repository.getSecretEnvelope(providerId, identity.walletAddress);
    const credential = storedCredential
      ? {
          kind: storedCredential.kind,
          ...(storedCredential.headerName ? { headerName: storedCredential.headerName } : {}),
          secret: openProviderCredential(storedCredential.envelope),
        }
      : undefined;
    const health = await verifyProviderHealth(provider, credential);
    const updated = await repository.recordHealth(
      providerId,
      identity.walletAddress,
      health,
    );
    return NextResponse.json({ provider: updated, health }, { status: health.status === "healthy" ? 200 : 502 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
