import { NextResponse } from "next/server";
import { ApplicationError } from "@canalis/application";
import { apiErrorResponse } from "../../../../server/api";
import { requireWalletSession } from "../../../../server/auth";
import { getTransactionRepository } from "../../../../server/transactions";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { eventId } = await params;
    const repository = await getTransactionRepository();
    const record = await repository.getById(decodeURIComponent(eventId), identity.walletAddress);
    if (!record) throw new ApplicationError("TASK_NOT_FOUND", "Transaction or receipt record not found.", 404);
    return NextResponse.json({ record });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
