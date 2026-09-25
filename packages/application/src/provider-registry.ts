import { z } from "zod";
import type { ProviderProtocol } from "@canalis/providers";
import { ApplicationError } from "./errors.js";
import { parseUsdc, type JsonObject, type ProviderMode } from "./contracts.js";

export const providerRegistryStatuses = ["active", "disabled"] as const;
export type ProviderRegistryStatus = (typeof providerRegistryStatuses)[number];

export const providerHealthStatuses = ["unknown", "healthy", "unhealthy"] as const;
export type ProviderHealthStatus = (typeof providerHealthStatuses)[number];

export const providerPricingModels = ["fixed", "challenge", "metered"] as const;
export type ProviderPricingModel = (typeof providerPricingModels)[number];

const providerIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/i, "Use letters, numbers, dots, underscores, colons, or dashes.");

const moneySchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, "Use a non-negative USDC amount with at most 6 decimals.");

const metadataValue = z.union([z.string().max(500), z.number().finite(), z.boolean()]);
const policyMetadataSchema = z.record(metadataValue).default({});
const constraintSchema = z.array(z.string().trim().min(1).max(180)).max(16);

const credentialSchema = z.object({
  kind: z.enum(["bearer", "api-key"]),
  headerName: z.string().trim().min(1).max(100).optional(),
  secret: z.string().min(1).max(8_192),
}).strict();

export const providerRegistryCreateSchema = z.object({
  id: providerIdSchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1).max(1_000),
  protocol: z.enum(["demo", "x402", "mpp"]),
  endpoint: z.string().trim().url().max(2_048).optional(),
  payee: z.string().trim().min(1).max(220),
  supportedNetworks: constraintSchema.default([]),
  supportedAssets: constraintSchema.default([]),
  pricingModel: z.enum(providerPricingModels).default("challenge"),
  fixedPriceUsd: moneySchema.optional(),
  defaultChannelCeilingUsd: moneySchema.optional(),
  policyMetadata: policyMetadataSchema,
  credential: credentialSchema.optional(),
}).strict();

export type ProviderRegistryCreateInput = z.output<typeof providerRegistryCreateSchema>;

export const providerRegistryUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().min(1).max(1_000).optional(),
  endpoint: z.string().trim().url().max(2_048).nullable().optional(),
  payee: z.string().trim().min(1).max(220).optional(),
  supportedNetworks: constraintSchema.optional(),
  supportedAssets: constraintSchema.optional(),
  pricingModel: z.enum(providerPricingModels).optional(),
  fixedPriceUsd: moneySchema.nullable().optional(),
  defaultChannelCeilingUsd: moneySchema.nullable().optional(),
  policyMetadata: z.record(metadataValue).optional(),
  credential: credentialSchema.optional(),
  clearCredential: z.boolean().optional(),
}).strict();

export type ProviderRegistryUpdateInput = z.output<typeof providerRegistryUpdateSchema>;

export type ProviderCredentialInput = z.output<typeof credentialSchema>;

export type ProviderRegistryRecord = {
  id: string;
  name: string;
  description: string;
  protocol: ProviderProtocol;
  mode: ProviderMode;
  endpoint?: string;
  payee: string;
  ownerWallet?: string;
  systemManaged: boolean;
  status: ProviderRegistryStatus;
  healthStatus: ProviderHealthStatus;
  supportedNetworks: string[];
  supportedAssets: string[];
  pricingModel: ProviderPricingModel;
  fixedPriceAtomic?: string;
  defaultChannelCeilingAtomic?: string;
  policyMetadata: JsonObject;
  hasCredential: boolean;
  credentialKind?: "bearer" | "api-key";
  credentialHeaderName?: string;
  lastHealthCheckAtUnixSeconds?: string;
  lastSuccessAtUnixSeconds?: string;
  lastErrorAtUnixSeconds?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAtUnixSeconds: string;
  updatedAtUnixSeconds: string;
  usage: {
    tasks: number;
    channels: number;
    flows: number;
  };
};

export type ProviderRegistryCreateRecord = Omit<
  ProviderRegistryRecord,
  | "healthStatus"
  | "hasCredential"
  | "credentialKind"
  | "credentialHeaderName"
  | "lastHealthCheckAtUnixSeconds"
  | "lastSuccessAtUnixSeconds"
  | "lastErrorAtUnixSeconds"
  | "lastErrorCode"
  | "lastErrorMessage"
  | "createdAtUnixSeconds"
  | "updatedAtUnixSeconds"
  | "usage"
> & {
  fixedPriceAtomic?: string;
  defaultChannelCeilingAtomic?: string;
};

export type ProviderHealthResult = {
  status: Exclude<ProviderHealthStatus, "unknown">;
  checkedAtUnixSeconds: string;
  latencyMs: number;
  code?: string;
  message: string;
  protocolMetadata?: JsonObject;
};

export function providerModeForProtocol(protocol: ProviderProtocol): ProviderMode {
  if (protocol === "demo") return "deterministic";
  return protocol;
}

function normalizeCreate(input: ProviderRegistryCreateInput): ProviderRegistryCreateInput {
  const protocol = input.protocol;
  const endpoint = input.endpoint?.trim() || undefined;
  if (protocol !== "demo" && !endpoint) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${protocol.toUpperCase()} providers require an endpoint.`,
      400,
    );
  }
  if (protocol !== "demo" && input.supportedNetworks.length === 0) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Live providers must declare at least one supported network.",
      400,
    );
  }
  if (protocol !== "demo" && input.supportedAssets.length === 0) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Live providers must declare at least one supported asset.",
      400,
    );
  }
  if (input.pricingModel === "fixed" && !input.fixedPriceUsd) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Fixed-price providers require a fixed price.",
      400,
    );
  }
  if (input.fixedPriceUsd !== undefined && parseUsdc(input.fixedPriceUsd) <= 0n) {
    throw new ApplicationError("VALIDATION_ERROR", "Fixed price must be greater than zero.", 400);
  }
  if (
    input.defaultChannelCeilingUsd !== undefined &&
    parseUsdc(input.defaultChannelCeilingUsd) <= 0n
  ) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Default channel ceiling must be greater than zero.",
      400,
    );
  }
  if (input.credential?.kind === "api-key" && !input.credential.headerName) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "API-key credentials require a header name.",
      400,
    );
  }
  return { ...input, ...(endpoint ? { endpoint } : {}) };
}

export function parseProviderRegistryCreate(input: unknown): ProviderRegistryCreateInput {
  const parsed = providerRegistryCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Provider configuration validation failed.",
      400,
      parsed.error.flatten(),
    );
  }
  return normalizeCreate(parsed.data);
}

export function parseProviderRegistryUpdate(input: unknown): ProviderRegistryUpdateInput {
  const parsed = providerRegistryUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Provider update validation failed.",
      400,
      parsed.error.flatten(),
    );
  }
  if (parsed.data.credential && parsed.data.clearCredential) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Choose either a replacement credential or clearCredential, not both.",
      400,
    );
  }
  if (parsed.data.credential?.kind === "api-key" && !parsed.data.credential.headerName) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "API-key credentials require a header name.",
      400,
    );
  }
  if (parsed.data.fixedPriceUsd && parseUsdc(parsed.data.fixedPriceUsd) <= 0n) {
    throw new ApplicationError("VALIDATION_ERROR", "Fixed price must be greater than zero.", 400);
  }
  if (
    parsed.data.defaultChannelCeilingUsd &&
    parseUsdc(parsed.data.defaultChannelCeilingUsd) <= 0n
  ) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Default channel ceiling must be greater than zero.",
      400,
    );
  }
  return parsed.data;
}

export function providerSelectable(record: Pick<ProviderRegistryRecord, "status" | "healthStatus" | "protocol">): boolean {
  if (record.status !== "active") return false;
  if (record.protocol === "demo") return record.healthStatus !== "unhealthy";
  return record.healthStatus === "healthy";
}

export function assertProviderSelectable(
  record: Pick<ProviderRegistryRecord, "name" | "status" | "healthStatus" | "protocol">,
): void {
  if (record.status !== "active") {
    throw new ApplicationError("PROVIDER_DISABLED", `${record.name} is disabled.`, 409);
  }
  if (record.protocol !== "demo" && record.healthStatus !== "healthy") {
    throw new ApplicationError(
      "PROVIDER_UNHEALTHY",
      `${record.name} must pass a provider health check before it can be used by a task.`,
      409,
    );
  }
  if (record.healthStatus === "unhealthy") {
    throw new ApplicationError(
      "PROVIDER_UNHEALTHY",
      `${record.name} is currently unhealthy.`,
      409,
    );
  }
}
