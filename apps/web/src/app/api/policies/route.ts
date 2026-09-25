import { NextResponse } from "next/server";
import { parseReusablePolicyCreate } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { getPolicyRepository } from "../../../server/policies";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("archived") === "1";
    const repository = await getPolicyRepository();
    return NextResponse.json({ policies: await repository.list(identity.walletAddress, includeArchived) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const input = parseReusablePolicyCreate(await readJsonBody(request));
    const repository = await getPolicyRepository();
    const policy = await repository.create(identity.walletAddress, input.name, input.description, input.rules);
    return NextResponse.json({ policy }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
