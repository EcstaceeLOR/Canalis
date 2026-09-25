import { NextResponse } from "next/server";
import { parseTransactionExplorerQuery } from "@canalis/application";
import { apiErrorResponse } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { getTransactionExplorerRepository } from "../../../server/transactions";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const query = parseTransactionExplorerQuery(new URL(request.url), identity.walletAddress);
    const repository = await getTransactionExplorerRepository();
    return NextResponse.json(await repository.listEvents(query));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
