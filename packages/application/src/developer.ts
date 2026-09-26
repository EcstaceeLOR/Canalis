import { z } from "zod";
import { ApplicationError } from "./errors.js";

export const developerApiVersion = "v1" as const;

export const developerApiScopes = [
  "tasks:read",
  "tasks:write",
  "tasks:execute",
  "channels:read",
  "channels:write",
  "receipts:read",
  "webhooks:read",
  "webhooks:write",
] as const;
export type DeveloperApiScope = (typeof developerApiScopes)[number];

export const developerEnvironments = ["sandbox", "production"] as const;
export type DeveloperEnvironment = (typeof developerEnvironments)[number];

export const webhookEventTypes = [
  "task.created",
  "task.executed",
  "task.completed",
  "task.cancelled",
  "channel.updated",
  "channel.finalized",
  "channel.recovered",
  "payment.authorized",
  "payment.rejected",
  "settlement.completed",
  "settlement.failed",
] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  scopes: z.array(z.enum(developerApiScopes)).min(1).max(developerApiScopes.length),
  environment: z.enum(developerEnvironments).default("sandbox"),
  expiresAtUnixSeconds: z.coerce.number().int().positive().optional(),
}).strict();

export const webhookSubscriptionCreateSchema = z.object({
  url: z.string().trim().url().max(2048),
  events: z.array(z.enum(webhookEventTypes)).min(1).max(webhookEventTypes.length),
  description: z.string().trim().max(500).default(""),
}).strict();

export const webhookSubscriptionUpdateSchema = z.object({
  url: z.string().trim().url().max(2048).optional(),
  events: z.array(z.enum(webhookEventTypes)).min(1).max(webhookEventTypes.length).optional(),
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
}).strict();

export const webhookRetrySchema = z.object({
  deliveryId: z.string().trim().min(1).max(120),
}).strict();

function validationError(message: string, error: z.ZodError): never {
  throw new ApplicationError("VALIDATION_ERROR", message, 400, error.flatten());
}

export function parseApiKeyCreate(input: unknown) {
  const parsed = apiKeyCreateSchema.safeParse(input);
  if (!parsed.success) validationError("API key configuration is invalid.", parsed.error);
  return { ...parsed.data, scopes: [...new Set(parsed.data.scopes)] };
}

export function parseWebhookSubscriptionCreate(input: unknown) {
  const parsed = webhookSubscriptionCreateSchema.safeParse(input);
  if (!parsed.success) validationError("Webhook subscription is invalid.", parsed.error);
  return { ...parsed.data, events: [...new Set(parsed.data.events)] };
}

export function parseWebhookSubscriptionUpdate(input: unknown) {
  const parsed = webhookSubscriptionUpdateSchema.safeParse(input);
  if (!parsed.success) validationError("Webhook subscription update is invalid.", parsed.error);
  return parsed.data.events ? { ...parsed.data, events: [...new Set(parsed.data.events)] } : parsed.data;
}

export function parseWebhookRetry(input: unknown) {
  const parsed = webhookRetrySchema.safeParse(input);
  if (!parsed.success) validationError("Webhook retry request is invalid.", parsed.error);
  return parsed.data;
}

export type DeveloperApiKeyRecord = {
  id: string;
  ownerWallet: string;
  name: string;
  prefix: string;
  scopes: DeveloperApiScope[];
  environment: DeveloperEnvironment;
  status: "active" | "revoked";
  createdAtUnixSeconds: string;
  updatedAtUnixSeconds: string;
  lastUsedAtUnixSeconds?: string;
  expiresAtUnixSeconds?: string;
  revokedAtUnixSeconds?: string;
};

export type WebhookSubscriptionRecord = {
  id: string;
  ownerWallet: string;
  url: string;
  description: string;
  events: WebhookEventType[];
  enabled: boolean;
  createdAtUnixSeconds: string;
  updatedAtUnixSeconds: string;
  lastSuccessAtUnixSeconds?: string;
  lastFailureAtUnixSeconds?: string;
};

export type WebhookDeliveryRecord = {
  id: string;
  eventId: string;
  subscriptionId: string;
  eventType: WebhookEventType;
  status: "pending" | "succeeded" | "failed";
  attempt: number;
  responseStatus?: number;
  errorCode?: string;
  createdAtUnixSeconds: string;
  deliveredAtUnixSeconds?: string;
  nextAttemptAtUnixSeconds?: string;
};

export type DeveloperIdentity = {
  walletAddress: string;
  keyId: string;
  scopes: DeveloperApiScope[];
  environment: DeveloperEnvironment;
};
