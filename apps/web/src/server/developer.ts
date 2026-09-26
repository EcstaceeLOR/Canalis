import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  ApplicationError,
  type DeveloperApiKeyRecord,
  type DeveloperApiScope,
  type DeveloperIdentity,
  type DeveloperEnvironment,
  type WebhookEventType,
} from "@canalis/application";
import { PostgresDeveloperRepository } from "@canalis/persistence";
import { getCanalisApplication } from "./canalis";
import { enforceAuthenticatedRateLimit } from "./security";

let repository: PostgresDeveloperRepository | undefined;
let initialization: Promise<PostgresDeveloperRepository> | undefined;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new ApplicationError("STORAGE_NOT_CONFIGURED", "Canalis durable storage is not configured.", 503);
  return value;
}

export async function getDeveloperRepository(): Promise<PostgresDeveloperRepository> {
  if (repository) return repository;
  if (!initialization) {
    initialization = (async () => {
      await getCanalisApplication();
      repository = new PostgresDeveloperRepository(databaseUrl());
      return repository;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function developerSecretKey(): Buffer {
  const encoded = process.env.CANALIS_DEVELOPER_SECRET_KEY?.trim();
  if (!encoded) {
    throw new ApplicationError(
      "DEVELOPER_SECRET_NOT_CONFIGURED",
      "Developer credential encryption is not configured. Set CANALIS_DEVELOPER_SECRET_KEY.",
      503,
    );
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new ApplicationError("DEVELOPER_SECRET_INVALID", "CANALIS_DEVELOPER_SECRET_KEY must decode to exactly 32 bytes.", 503);
  return key;
}

function sealSecret(secret: string): Record<string, string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", developerSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { version: "v1", iv: iv.toString("base64"), ciphertext: encrypted.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function openSecret(envelope: Record<string, unknown>): string {
  if (envelope.version !== "v1" || typeof envelope.iv !== "string" || typeof envelope.ciphertext !== "string" || typeof envelope.tag !== "string") {
    throw new ApplicationError("WEBHOOK_SECRET_INVALID", "Stored webhook secret envelope is invalid.", 500);
  }
  const decipher = createDecipheriv("aes-256-gcm", developerSecretKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function issueApiToken(environment: DeveloperEnvironment): { token: string; prefix: string; hash: string } {
  const marker = environment === "sandbox" ? "sbx" : "live";
  const id = randomBytes(6).toString("hex");
  const token = `cnl_${marker}_${id}_${randomBytes(24).toString("base64url")}`;
  return { token, prefix: `cnl_${marker}_${id}`, hash: sha256(token) };
}

export function issueWebhookSecret(): { secret: string; envelope: Record<string, string> } {
  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  return { secret, envelope: sealSecret(secret) };
}

function tokenFromRequest(request: Request): string | undefined {
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return request.headers.get("x-canalis-key")?.trim() || undefined;
}

export async function requireDeveloperIdentity(request: Request, requiredScopes: DeveloperApiScope[] = []): Promise<DeveloperIdentity> {
  const token = tokenFromRequest(request);
  if (!token || !/^cnl_(sbx|live)_[a-f0-9]{12}_[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new ApplicationError("API_KEY_REQUIRED", "A valid Canalis API key is required.", 401);
  }
  const record = await (await getDeveloperRepository()).authenticateApiKey(sha256(token));
  if (!record) throw new ApplicationError("API_KEY_INVALID", "API key is invalid, revoked, or expired.", 401);
  for (const scope of requiredScopes) {
    if (!record.scopes.includes(scope)) {
      throw new ApplicationError("API_KEY_SCOPE_REQUIRED", `API key requires scope ${scope}.`, 403, { requiredScope: scope });
    }
  }
  await enforceAuthenticatedRateLimit(request, record.ownerWallet);
  return { walletAddress: record.ownerWallet, keyId: record.id, scopes: record.scopes, environment: record.environment };
}

export function assertSandboxCompatible(identity: DeveloperIdentity, applicationEnvironment: string, requestedMode?: string): void {
  if (identity.environment !== "sandbox") return;
  if (applicationEnvironment === "mainnet") {
    throw new ApplicationError("SANDBOX_MAINNET_BLOCKED", "Sandbox API keys cannot operate a mainnet workspace.", 409);
  }
  if (requestedMode && !["deterministic", "x402"].includes(requestedMode)) {
    throw new ApplicationError("SANDBOX_MODE_UNAVAILABLE", "Sandbox keys support deterministic or devnet x402 execution only.", 409);
  }
}

export function apiKeyPublicRecord(record: DeveloperApiKeyRecord) { return record; }

function privateIpv4(address: string): boolean {
  const p = address.split(".").map(Number);
  if (p.length !== 4 || p.some((value) => !Number.isInteger(value))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function privateIpv6(address: string): boolean {
  const value = address.toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
    value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") ||
    value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.") || value.startsWith("::ffff:192.168.");
}
function privateAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? privateIpv4(address) : version === 6 ? privateIpv6(address) : true;
}

export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ApplicationError("WEBHOOK_URL_INVALID", "Webhook URL is invalid.", 400); }
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new ApplicationError("WEBHOOK_URL_INSECURE", "Webhook URLs must use HTTPS outside local development.", 400);
  }
  if (url.username || url.password) throw new ApplicationError("WEBHOOK_URL_INVALID", "Webhook URLs must not contain credentials.", 400);
  if (!local) {
    const resolved = await lookup(url.hostname, { all: true, verbatim: true });
    if (!resolved.length || resolved.some((entry) => privateAddress(entry.address))) {
      throw new ApplicationError("WEBHOOK_URL_BLOCKED", "Webhook URL resolves to a private or reserved network address.", 400);
    }
  }
  return url;
}

function deliveryBody(event: { id: string; eventType: WebhookEventType; createdAtUnixSeconds: string; payload: Record<string, unknown> }): string {
  return JSON.stringify({ id: event.id, type: event.eventType, apiVersion: "v1", createdAtUnixSeconds: event.createdAtUnixSeconds, data: event.payload });
}

async function deliver(input: {
  ownerWallet: string;
  subscription: Awaited<ReturnType<PostgresDeveloperRepository["getWebhook"]>> extends infer T ? NonNullable<T> : never;
  event: { id: string; eventType: WebhookEventType; createdAtUnixSeconds: string; payload: Record<string, unknown> };
  attempt: number;
}) {
  const store = await getDeveloperRepository();
  const deliveryId = `whd_${randomUUID()}`;
  await store.createDelivery({ id: deliveryId, eventId: input.event.id, subscriptionId: input.subscription.id, attempt: input.attempt });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = deliveryBody(input.event);
  const secret = openSecret(input.subscription.secretEnvelope);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  let responseStatus: number | undefined;
  let errorCode: string | undefined;
  try {
    const url = await assertSafeWebhookUrl(input.subscription.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "user-agent": "Canalis-Webhooks/1.0",
          "canalis-api-version": "v1",
          "canalis-event-id": input.event.id,
          "canalis-event-type": input.event.eventType,
          "canalis-delivery-id": deliveryId,
          "canalis-timestamp": timestamp,
          "canalis-signature": `v1=${signature}`,
        },
        body,
      });
      responseStatus = response.status;
      if (response.ok) {
        await store.finishDelivery({ id: deliveryId, succeeded: true, responseStatus });
        return { id: deliveryId, succeeded: true };
      }
      errorCode = `HTTP_${response.status}`;
    } finally { clearTimeout(timeout); }
  } catch (error) {
    errorCode = error instanceof Error && error.name === "AbortError" ? "WEBHOOK_TIMEOUT" : "WEBHOOK_DELIVERY_FAILED";
  }
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.max(0, input.attempt - 1));
  await store.finishDelivery({
    id: deliveryId,
    succeeded: false,
    ...(responseStatus !== undefined ? { responseStatus } : {}),
    errorCode: errorCode ?? "WEBHOOK_DELIVERY_FAILED",
    nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
  });
  return { id: deliveryId, succeeded: false };
}

export async function publishWebhookEvent(ownerWallet: string, eventType: WebhookEventType, payload: Record<string, unknown>) {
  const store = await getDeveloperRepository();
  const event = await store.createWebhookEvent({ id: `evt_${randomUUID()}`, ownerWallet, eventType, payload });
  const subscriptions = await store.matchingWebhooks(ownerWallet, eventType);
  const deliveries = await Promise.all(subscriptions.map((subscription) => deliver({ ownerWallet, subscription, event, attempt: 1 })));
  return { eventId: event.id, deliveries };
}

export async function retryWebhookDelivery(ownerWallet: string, deliveryId: string) {
  const store = await getDeveloperRepository();
  const record = await store.getDelivery(deliveryId, ownerWallet);
  if (!record) throw new ApplicationError("WEBHOOK_DELIVERY_NOT_FOUND", "Webhook delivery not found.", 404);
  if (record.delivery.status === "succeeded") return { deliveryId, idempotent: true, status: "succeeded" };
  const result = await deliver({ ownerWallet, subscription: record.subscription, event: record.event, attempt: record.delivery.attempt + 1 });
  return { deliveryId: result.id, retriedFrom: deliveryId, status: result.succeeded ? "succeeded" : "failed" };
}

export async function resetDeveloperForTests(): Promise<void> {
  if (initialization) { try { await initialization; } catch { /* test cleanup */ } }
  if (repository) await repository.close();
  repository = undefined;
  initialization = undefined;
}
