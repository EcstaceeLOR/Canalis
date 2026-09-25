import { NextResponse } from "next/server";
import {
  ApplicationError,
  parseProviderRegistryUpdate,
  type ProviderRegistryStatus,
} from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../server/api";
import { requireWalletSession } from "../../../../server/auth";
import { sealProviderCredential } from "../../../../server/provider-secrets";
import { getProviderRegistryRepository } from "../../../../server/providers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { providerId } = await params;
    const repository = await getProviderRegistryRepository();
    const provider = await repository.getProvider(providerId, identity.walletAddress);
    if (!provider) throw new ApplicationError("PROVIDER_NOT_FOUND", "Provider not found.", 404);
    return NextResponse.json({ provider });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { providerId } = await params;
    const body = await readJsonBody(request);
    const repository = await getProviderRegistryRepository();

    if (
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body as Record<string, unknown>).length === 1 &&
      typeof (body as Record<string, unknown>).status === "string"
    ) {
      const status = (body as Record<string, unknown>).status;
      if (status !== "active" && status !== "disabled") {
        throw new ApplicationError("VALIDATION_ERROR", "Provider status must be active or disabled.", 400);
      }
      const provider = await repository.setStatus(
        providerId,
        identity.walletAddress,
        status as ProviderRegistryStatus,
      );
      return NextResponse.json({ provider });
    }

    const current = await repository.getProvider(providerId, identity.walletAddress);
    if (!current || current.systemManaged) {
      throw new ApplicationError(
        "PROVIDER_NOT_FOUND",
        "Provider not found or is system-managed.",
        404,
      );
    }

    const input = parseProviderRegistryUpdate(body);
    const endpoint = input.endpoint === undefined ? current.endpoint : input.endpoint ?? undefined;
    const networks = input.supportedNetworks ?? current.supportedNetworks;
    const assets = input.supportedAssets ?? current.supportedAssets;
    const pricingModel = input.pricingModel ?? current.pricingModel;
    const hasFixedPrice =
      input.fixedPriceUsd === undefined
        ? Boolean(current.fixedPriceAtomic)
        : input.fixedPriceUsd !== null;

    if (current.protocol !== "demo" && !endpoint) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        `${current.protocol.toUpperCase()} providers require an endpoint.`,
        400,
      );
    }
    if (current.protocol !== "demo" && networks.length === 0) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Live providers must declare at least one supported network.",
        400,
      );
    }
    if (current.protocol !== "demo" && assets.length === 0) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Live providers must declare at least one supported asset.",
        400,
      );
    }
    if (pricingModel === "fixed" && !hasFixedPrice) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Fixed-price providers require a fixed price.",
        400,
      );
    }

    const credentialMutation = input.credential
      ? {
          kind: input.credential.kind,
          ...(input.credential.headerName ? { headerName: input.credential.headerName } : {}),
          envelope: sealProviderCredential(input.credential),
        }
      : input.clearCredential
        ? null
        : undefined;
    const provider = await repository.updateProvider(
      providerId,
      identity.walletAddress,
      input,
      credentialMutation,
    );
    return NextResponse.json({ provider });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
