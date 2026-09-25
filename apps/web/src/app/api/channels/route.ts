import { NextResponse } from "next/server";
import { parseChannelListQuery } from "@canalis/application";
import { apiErrorResponse } from "../../server/api";
import { requireWalletSession } from "../../server/auth";
import { getChannelWorkspaceRepository } from "../../server/channels";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const query = parseChannelListQuery(new URL(request.url), identity.walletAddress);
    const repository = await getChannelWorkspaceRepository();
    return NextResponse.json(await repository.listChannels(query));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
