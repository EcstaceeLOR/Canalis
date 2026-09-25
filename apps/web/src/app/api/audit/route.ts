import { NextResponse } from "next/server";
import { ApplicationError } from "@canalis/application";
import { apiErrorResponse } from "../../../server/api";
import { requireWalletSession } from "../../../server/auth";
import { getAuditEvents } from "../../../server/security";

function parseLimit(request: Request): number {
  const raw = new URL(request.url).searchParams.get("limit");
  if (!raw) return 100;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new ApplicationError("VALIDATION_ERROR", "Audit limit must be an integer between 1 and 500.", 400);
  }
  return value;
}

export async function GET(request: Request) {
  try {
    const identity = await requireWalletSession(request);
    const events = await getAuditEvents(identity.walletAddress, parseLimit(request));
    return NextResponse.json({ events });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
