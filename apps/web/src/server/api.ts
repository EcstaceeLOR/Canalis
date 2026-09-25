import {
  ApplicationError,
  type ApiErrorEnvelope,
} from "@canalis/application";
import { NextResponse } from "next/server";

const MAX_JSON_BODY_BYTES = 64 * 1024;

export function assertRequestOrigin(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin")?.trim();
  if (!origin) return;

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    throw new ApplicationError("ORIGIN_NOT_ALLOWED", "Request origin is invalid.", 403);
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim().toLowerCase();
  const requestHost = new URL(request.url).host.toLowerCase();
  const expectedHost = forwardedHost || requestHost;
  if (originHost !== expectedHost) {
    throw new ApplicationError(
      "ORIGIN_NOT_ALLOWED",
      "Cross-origin mutation requests are not allowed.",
      403,
    );
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  assertRequestOrigin(request);
  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (contentType && !contentType.startsWith("application/json")) {
    throw new ApplicationError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Request body must use application/json.",
      415,
    );
  }

  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new ApplicationError("REQUEST_BODY_TOO_LARGE", "Request body is too large.", 413);
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BODY_BYTES) {
    throw new ApplicationError("REQUEST_BODY_TOO_LARGE", "Request body is too large.", 413);
  }
  try {
    return JSON.parse(raw);
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
    const safeDetails = error.code === "VALIDATION_ERROR" && error.status < 500
      ? error.details
      : undefined;
    const response = NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(safeDetails !== undefined ? { details: safeDetails } : {}),
        },
      },
      { status: error.status },
    );
    if (error.code === "RATE_LIMITED") {
      const detail = error.details && typeof error.details === "object" && !Array.isArray(error.details)
        ? error.details as Record<string, unknown>
        : undefined;
      const retryAfter = Number(detail?.retryAfterSeconds ?? 60);
      response.headers.set("retry-after", String(Number.isFinite(retryAfter) ? Math.max(1, Math.ceil(retryAfter)) : 60));
    }
    return response;
  }

  // Do not log unknown Error messages/objects here. Upstream failures can carry
  // credentials, signatures, signed payloads, or provider response bodies.
  console.error("Canalis API request failed", {
    type: error instanceof Error ? error.name : typeof error,
  });
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
