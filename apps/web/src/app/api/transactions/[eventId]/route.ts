import { NextResponse } from "next/server";
import { ApplicationError } from "@canalis/application";
import { apiErrorResponse } from "../../../../server/api";
import { requireWalletSession } from "../../../../server/auth";
import { getTransactionExplorerRepository } from "../../../../server/transactions";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { eventId } = await params;
    const repository = await getTransactionExplorerRepository();
    const event = await repository.getEvent(eventId, identity.walletAddress);
    if (!event) throw new ApplicationError("TRANSACTION_EVENT_NOT_FOUND", "Transaction event not found.", 404);
    const related = await repository.listRelatedEvents(
      event.taskId,
      event.providerId,
      identity.walletAddress,
    );
    return NextResponse.json({ event, related });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
