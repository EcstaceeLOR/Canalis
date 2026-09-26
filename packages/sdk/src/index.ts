import { createHmac, timingSafeEqual } from "node:crypto";

export type CanalisSdkOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};

export type TaskCreateInput = {
  name: string;
  description?: string;
  agentId?: string;
  budgetUsd?: string;
  maxPerCallUsd?: string;
  expiryMinutes?: number;
  allowedProviders?: string[];
  policyId?: string;
  policyVersion?: number;
  policyOverrides?: Record<string, unknown>;
  mode?: "deterministic" | "x402" | "mpp";
  saveAsDraft?: boolean;
};

export type WebhookEventType =
  | "task.created"
  | "task.executed"
  | "task.completed"
  | "task.cancelled"
  | "channel.updated"
  | "channel.finalized"
  | "channel.recovered"
  | "payment.authorized"
  | "payment.rejected"
  | "settlement.completed"
  | "settlement.failed";

export type WebhookSubscriptionInput = {
  url: string;
  events: WebhookEventType[];
  description?: string;
};

export class CanalisApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "CanalisApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function idempotencyKey(): string {
  return `sdk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export class CanalisClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: CanalisSdkOptions) {
    if (!options.apiKey?.trim()) throw new Error("Canalis apiKey is required");
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? "https://canalis-sigma.vercel.app").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error("A fetch implementation is required");
  }

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; idempotencyKey?: string; query?: URLSearchParams } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.query) url.search = options.query.toString();
    const headers = new Headers({
      authorization: `Bearer ${this.apiKey}`,
      accept: "application/json",
    });
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (!["GET", "HEAD"].includes(method)) headers.set("idempotency-key", options.idempotencyKey ?? idempotencyKey());
    const response = await this.fetchImpl(url, {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    let body: unknown = undefined;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!response.ok) {
      const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      throw new CanalisApiError(
        typeof record.message === "string" ? record.message : `Canalis API request failed with HTTP ${response.status}`,
        response.status,
        typeof record.code === "string" ? record.code : undefined,
        record.details,
      );
    }
    return body as T;
  }

  readonly tasks = {
    list: async (options: { page?: number; pageSize?: number; status?: string; query?: string } = {}) => {
      const query = new URLSearchParams();
      if (options.page) query.set("page", String(options.page));
      if (options.pageSize) query.set("pageSize", String(options.pageSize));
      if (options.status) query.set("status", options.status);
      if (options.query) query.set("q", options.query);
      return this.request<Record<string, unknown>>("GET", "/api/v1/tasks", { query });
    },
    create: async (input: TaskCreateInput, options: { idempotencyKey?: string } = {}) =>
      this.request<Record<string, unknown>>("POST", "/api/v1/tasks", { body: input, idempotencyKey: options.idempotencyKey }),
    get: async (taskId: string) =>
      this.request<Record<string, unknown>>("GET", `/api/v1/tasks/${encodeURIComponent(taskId)}`),
    execute: async (taskId: string, options: { idempotencyKey?: string } = {}) =>
      this.request<Record<string, unknown>>("POST", `/api/v1/tasks/${encodeURIComponent(taskId)}/execute`, { body: {}, idempotencyKey: options.idempotencyKey }),
    channels: async (taskId: string) =>
      this.request<Record<string, unknown>>("GET", `/api/v1/tasks/${encodeURIComponent(taskId)}/channels`),
    receipts: async (taskId: string) =>
      this.request<Record<string, unknown>>("GET", `/api/v1/tasks/${encodeURIComponent(taskId)}/receipts`),
    channelAction: async (taskId: string, providerId: string, action: "finalize" | "recover", options: { idempotencyKey?: string } = {}) =>
      this.request<Record<string, unknown>>(
        "POST",
        `/api/v1/tasks/${encodeURIComponent(taskId)}/channels/${encodeURIComponent(providerId)}/action`,
        { body: { action }, idempotencyKey: options.idempotencyKey },
      ),
  };

  readonly webhooks = {
    list: async () => this.request<Record<string, unknown>>("GET", "/api/v1/webhooks"),
    create: async (input: WebhookSubscriptionInput, options: { idempotencyKey?: string } = {}) =>
      this.request<Record<string, unknown>>("POST", "/api/v1/webhooks", { body: input, idempotencyKey: options.idempotencyKey }),
    update: async (id: string, input: Partial<WebhookSubscriptionInput> & { enabled?: boolean }, options: { idempotencyKey?: string } = {}) =>
      this.request<Record<string, unknown>>("PATCH", `/api/v1/webhooks/${encodeURIComponent(id)}`, { body: input, idempotencyKey: options.idempotencyKey }),
    rotateSecret: async (id: string, options: { idempotencyKey?: string } = {}) =>
      this.request<Record<string, unknown>>("POST", `/api/v1/webhooks/${encodeURIComponent(id)}/rotate`, { body: {}, idempotencyKey: options.idempotencyKey }),
    retryDelivery: async (deliveryId: string, options: { idempotencyKey?: string } = {}) =>
      this.request<Record<string, unknown>>("POST", `/api/v1/webhooks/deliveries/${encodeURIComponent(deliveryId)}/retry`, { body: {}, idempotencyKey: options.idempotencyKey }),
  };
}

export function verifyCanalisWebhook(input: {
  rawBody: string;
  secret: string;
  signature: string;
  timestamp: string;
  toleranceSeconds?: number;
  nowUnixSeconds?: number;
}): boolean {
  const timestamp = Number(input.timestamp);
  if (!Number.isInteger(timestamp)) return false;
  const now = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(now - timestamp) > tolerance) return false;
  const supplied = input.signature.startsWith("v1=") ? input.signature.slice(3) : input.signature;
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", input.secret).update(`${input.timestamp}.${input.rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(supplied, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
