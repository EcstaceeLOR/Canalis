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
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
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
