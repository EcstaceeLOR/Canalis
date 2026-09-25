import { NextResponse } from "next/server";
import { assertIntegrationCompatible, parseProviderRegistryCreate, type ProviderMode } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { candidateFromCreate } from "../../../server/integrations";
import { providerRuntimeReady } from "../../../server/provider-selection";
import { sealProviderCredential } from "../../../server/provider-secrets";
import { getProviderRegistryRepository } from "../../../server/providers";
import { getSettingsRepository } from "../../../server/settings";

const executionModes: ProviderMode[] = ["deterministic", "x402", "mpp"];

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const url = new URL(request.url);
    const selectableOnly = url.searchParams.get("selectable") === "1";
    const repository = await getProviderRegistryRepository();
    const providers = await repository.listProviders(identity.walletAddress, selectableOnly);
    return NextResponse.json({
      providers: providers.map((provider) => ({
        ...provider,
        executionModes: executionModes.filter((mode) => providerRuntimeReady(provider, mode)),
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const input = parseProviderRegistryCreate(await readJsonBody(request));
    const settings = await (await getSettingsRepository()).get(identity.walletAddress);
    assertIntegrationCompatible(settings, candidateFromCreate(input));

    const repository = await getProviderRegistryRepository();
    const credential = input.credential
      ? {
          kind: input.credential.kind,
          ...(input.credential.headerName ? { headerName: input.credential.headerName } : {}),
          envelope: sealProviderCredential(input.credential),
        }
      : undefined;
    const provider = await repository.createProvider(identity.walletAddress, input, credential);
    return NextResponse.json({ provider }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
