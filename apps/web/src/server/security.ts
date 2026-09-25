import { createHash } from "node:crypto";
import { ApplicationError } from "@canalis/application";
import { PostgresSecurityRepository } from "@canalis/persistence";
import { NextResponse } from "next/server";
import { apiErrorResponse } from "./api";
import { getCanalisApplication } from "./canalis";

const EXPLICIT_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_IDEMPOTENCY_BODY_BYTES = 64 * 1024;

let repository: PostgresSecurityRepository | undefined;
let initialization: Promise<PostgresSecurityRepository> | undefined;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new ApplicationError(
      "STORAGE_NOT_CONFIGURED",
      "Canalis durable storage is not configured. Set DATABASE_URL to a Postgres connection string.",
      503,
    );
  }
  return value;
}

function boundedEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

async function securityRepository(): Promise<PostgresSecurityRepository> {
  if (repository) return repository;
  if (!initialization) {
    initialization = (async () => {
      await getCanalisApplication();
      repository = new PostgresSecurityRepository(databaseUrl());
      return repository;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function enforcePublicRateLimit(
  request: Request,
  bucket: string,
  limit = boundedEnv("CANALIS_PUBLIC_AUTH_RATE_LIMIT_PER_MINUTE", 20, 2, 300),
  windowSeconds = 60,
): Promise<void> {
  const store = await securityRepository();
  const scopeKey = `public:${bucket}:${sha256(requestIp(request)).slice(0, 32)}`;
  const result = await store.consumeRateLimit({ scopeKey, limit, windowSeconds });
  if (!result.allowed) {
    throw new ApplicationError(
      "RATE_LIMITED",
      "Too many requests. Try again shortly.",
      429,
      { retryAfterSeconds: result.retryAfterSeconds },
    );
  }
}

export async function enforceAuthenticatedRateLimit(
  request: Request,
  walletAddress: string,
): Promise<void> {
  const limit = boundedEnv("CANALIS_AUTHENTICATED_RATE_LIMIT_PER_MINUTE", 240, 30, 2_000);
  const store = await securityRepository();
  const route = new URL(request.url).pathname.replace(/\/[A-Za-z0-9_-]{24,}/g, "/:id");
  const scopeKey = `wallet:${sha256(walletAddress).slice(0, 32)}:${request.method}:${route}`;
  const result = await store.consumeRateLimit({ scopeKey, limit, windowSeconds: 60 });
  if (!result.allowed) {
    throw new ApplicationError(
      "RATE_LIMITED",
      "This wallet is sending requests too quickly. Try again shortly.",
      429,
      { retryAfterSeconds: result.retryAfterSeconds },
    );
  }
}

async function requestFingerprint(request: Request, operation: string, resourceKey?: string): Promise<{ hash: string; body: string }> {
  const clone = request.clone();
  const body = await clone.text();
  if (Buffer.byteLength(body, "utf8") > MAX_IDEMPOTENCY_BODY_BYTES) {
    throw new ApplicationError(
      "REQUEST_BODY_TOO_LARGE",
      "Request body is too large.",
      413,
    );
  }
  return {
    hash: sha256(`${request.method}\n${operation}\n${resourceKey ?? ""}\n${body}`),
    body,
  };
}

function idempotencyKey(request: Request, requestHash: string): string {
  const explicit = request.headers.get("idempotency-key")?.trim();
  if (explicit) {
    if (!EXPLICIT_KEY_PATTERN.test(explicit)) {
      throw new ApplicationError(
        "IDEMPOTENCY_KEY_INVALID",
        "Idempotency-Key must be 8–128 characters using letters, numbers, dot, underscore, colon, or hyphen.",
        400,
      );
    }
    return explicit;
  }

  // Existing first-party clients remain safe even before they explicitly send a
  // key: identical mutations collapse inside a five-minute retry window. API/SDK
  // clients should send an explicit key when they need a longer retry horizon.
  const fiveMinuteBucket = Math.floor(Date.now() / 300_000);
  return `auto_${sha256(`${requestHash}:${fiveMinuteBucket}`).slice(0, 40)}`;
}

async function responseSnapshot(response: Response): Promise<{ status: number; body: string; contentType: string }> {
  const body = await response.clone().text();
  return {
    status: response.status,
    body,
    contentType: response.headers.get("content-type") ?? "application/json; charset=utf-8",
  };
}

export async function runIdempotentMutation(input: {
  request: Request;
  ownerWallet: string;
  operation: string;
  resourceKey?: string;
  handler: () => Promise<Response>;
}): Promise<Response> {
  const store = await securityRepository();
  const fingerprint = await requestFingerprint(input.request, input.operation, input.resourceKey);
  const key = idempotencyKey(input.request, fingerprint.hash);
  const ttlSeconds = boundedEnv("CANALIS_IDEMPOTENCY_TTL_SECONDS", 86_400, 300, 172_800);
  const begin = await store.beginIdempotency({
    ownerWallet: input.ownerWallet,
    operation: input.operation,
    idempotencyKey: key,
    requestHash: fingerprint.hash,
    ttlSeconds,
  });

  if (begin.status === "conflict") {
    throw new ApplicationError(
      "IDEMPOTENCY_KEY_REUSED",
      "This Idempotency-Key was already used with a different request.",
      409,
    );
  }
  if (begin.status === "in-progress") {
    throw new ApplicationError(
      "IDEMPOTENCY_IN_PROGRESS",
      "An identical mutation is already in progress. Retry with the same Idempotency-Key shortly.",
      409,
    );
  }
  if (begin.status === "replay") {
    return new Response(begin.responseBody, {
      status: begin.responseStatus,
      headers: {
        "content-type": begin.responseContentType,
        "idempotency-key": key,
        "idempotency-replayed": "true",
      },
    });
  }

  const holderKey = `${key}:${fingerprint.hash.slice(0, 16)}`;
  let locked = false;
  if (input.resourceKey) {
    locked = await store.acquireMutationLock({
      resourceKey: input.resourceKey,
      ownerWallet: input.ownerWallet,
      operation: input.operation,
      holderKey,
    });
    if (!locked) {
      throw new ApplicationError(
        "CONCURRENT_MUTATION",
        "Another mutation is already changing this resource. Retry after it finishes.",
        409,
      );
    }
  }

  try {
    let response: Response;
    try {
      response = await input.handler();
    } catch (error) {
      response = apiErrorResponse(error);
    }
    const snapshot = await responseSnapshot(response);
    await store.completeIdempotency({
      ownerWallet: input.ownerWallet,
      operation: input.operation,
      idempotencyKey: key,
      requestHash: fingerprint.hash,
      responseStatus: snapshot.status,
      responseBody: snapshot.body,
      responseContentType: snapshot.contentType,
      ttlSeconds,
    });
    const headers = new Headers(response.headers);
    headers.set("idempotency-key", key);
    return new Response(snapshot.body, { status: snapshot.status, headers });
  } finally {
    if (locked && input.resourceKey) {
      await store.releaseMutationLock(input.resourceKey, holderKey);
    }
  }
}

export async function getAuditEvents(ownerWallet: string, limit = 100) {
  return (await securityRepository()).listAuditEvents(ownerWallet, limit);
}

export async function resetSecurityForTests(): Promise<void> {
  if (initialization) {
    try { await initialization; } catch { /* ignore failed test initialization */ }
  }
  if (repository) await repository.close();
  repository = undefined;
  initialization = undefined;
}
