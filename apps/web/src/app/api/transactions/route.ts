import { NextResponse } from "next/server";
import { parseTransactionListQuery } from "@canalis/application";
import { apiErrorResponse } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { getTransactionRepository } from "../../../server/transactions";

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const query = parseTransactionListQuery(new URL(request.url), identity.walletAddress);
    const repository = await getTransactionRepository();
    return NextResponse.json(await repository.list(query));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
