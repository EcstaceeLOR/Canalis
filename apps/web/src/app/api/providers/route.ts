import { NextResponse } from "next/server";
import { parseProviderRegistryCreate } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { sealProviderCredential } from "../../../server/provider-secrets";
import { getProviderRegistryRepository } from "../../../server/providers";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const url = new URL(request.url);
    const selectableOnly = url.searchParams.get("selectable") === "1";
    const repository = await getProviderRegistryRepository();
    const providers = await repository.listProviders(identity.walletAddress, selectableOnly);
    return NextResponse.json({ providers });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const input = parseProviderRegistryCreate(await readJsonBody(request));
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
