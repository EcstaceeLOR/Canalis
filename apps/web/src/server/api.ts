import {
  ApplicationError,
  type ApiErrorEnvelope,
} from "@canalis/application";
import { NextResponse } from "next/server";

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request body must be valid JSON.",
      400,
    );
  }
}

export function apiErrorResponse(error: unknown): NextResponse<ApiErrorEnvelope> {
  if (error instanceof ApplicationError) {
    // Validation field errors are safe and useful to return. Operational error
    // details may contain upstream/provider diagnostics, so never expose those
    // raw structures to the browser; the stable code and safe message are the
    // public product contract.
    const safeDetails = error.code === "VALIDATION_ERROR" && error.status < 500
      ? error.details
      : undefined;
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(safeDetails !== undefined ? { details: safeDetails } : {}),
        },
      },
      { status: error.status },
    );
  }

  console.error("Canalis API request failed", error);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Canalis could not complete the request.",
      },
    },
    { status: 500 },
  );
}
