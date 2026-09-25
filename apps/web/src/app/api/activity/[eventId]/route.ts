import { NextResponse } from "next/server";
import { ApplicationError } from "@canalis/application";
import { apiErrorResponse, readJsonBody } from "../../../../server/api";
import { getActivityRepository } from "../../../../server/activity";
import { requireWalletSession } from "../../../../server/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const identity = await requireWalletSession(request);
    const { eventId } = await params;
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as Record<string, unknown>).read !== "boolean") {
      throw new ApplicationError("VALIDATION_ERROR", "Activity update requires a boolean read field.", 400);
    }
    const repository = await getActivityRepository();
    const event = await repository.markRead(identity.walletAddress, eventId, Boolean((body as Record<string, unknown>).read));
    if (!event) throw new ApplicationError("FORBIDDEN", "Activity event is unavailable to this wallet.", 404);
    return NextResponse.json({ event });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
