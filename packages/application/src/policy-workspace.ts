import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parseUsdc, providerIdSchema, type JsonObject, type ProviderMode } from "./contracts.js";
import { ApplicationError } from "./errors.js";

export const policyStatuses = ["active", "archived"] as const;
export type PolicyStatus = (typeof policyStatuses)[number];

export const policyProtocols = ["demo", "x402", "mpp"] as const;
export type PolicyProtocol = (typeof policyProtocols)[number];

const money = z.string().trim().regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, "Use a non-negative USDC amount with at most 6 decimals.");
const network = z.string().trim().min(1).max(160);
const mint = z.string().trim().min(1).max(160);
const providerCaps = z.record(providerIdSchema, money).default({});

export const reusablePolicyRulesSchema = z.object({
  totalCeilingUsd: money,
  maxPerCallUsd: money,
  allowedProviders: z.array(providerIdSchema).min(1).max(24),
  blockedProviders: z.array(providerIdSchema).max(24).default([]),
  providerCapsUsd: providerCaps,
  durationMinutes: z.coerce.number().int().min(1).max(10_080),
  allowedNetworks: z.array(network).max(12).default([]),
  allowedMints: z.array(mint).max(12).default([]),
  allowedProtocols: z.array(z.enum(policyProtocols)).min(1).max(3),
}).strict();

export type ReusablePolicyRulesInput = z.input<typeof reusablePolicyRulesSchema>;
export type ReusablePolicyRules = z.output<typeof reusablePolicyRulesSchema>;

export const reusablePolicyCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000).default(""),
  rules: reusablePolicyRulesSchema,
}).strict();

export const reusablePolicyUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1_000).optional(),
  rules: reusablePolicyRulesSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export const taskPolicyOverrideSchema = z.object({
  totalCeilingUsd: money.optional(),
  maxPerCallUsd: money.optional(),
  allowedProviders: z.array(providerIdSchema).min(1).max(24).optional(),
  blockedProviders: z.array(providerIdSchema).max(24).optional(),
  providerCapsUsd: providerCaps.optional(),
  durationMinutes: z.coerce.number().int().min(1).max(10_080).optional(),
  allowedNetworks: z.array(network).max(12).optional(),
  allowedMints: z.array(mint).max(12).optional(),
  allowedProtocols: z.array(z.enum(policyProtocols)).min(1).max(3).optional(),
}).strict();

export type TaskPolicyOverrides = z.output<typeof taskPolicyOverrideSchema>;

export type PolicyVersionRecord = {
  policyId: string;
  version: number;
  rules: ReusablePolicyRules;
  createdAtUnixSeconds: string;
};

export type PolicyRecord = {
  id: string;
  ownerWallet: string;
  name: string;
  description: string;
  status: PolicyStatus;
  latestVersion: number;
  latest: PolicyVersionRecord;
  usageCount: number;
  createdAtUnixSeconds: string;
  updatedAtUnixSeconds: string;
};

export type TaskPolicySnapshot = {
  sourcePolicyId?: string;
  sourcePolicyVersion?: number;
  sourcePolicyName: string;
  totalCeilingAtomic: string;
  maxPerCallAtomic?: string;
  allowedProviderIds: string[];
  blockedProviderIds: string[];
  providerCapsAtomic: Record<string, string>;
  durationMinutes: number;
  allowedNetworks: string[];
  allowedMints: string[];
  allowedProtocols: PolicyProtocol[];
  overrides: JsonObject;
};

export type ResolvedTaskPolicy = {
  sourcePolicyId?: string;
  sourcePolicyVersion?: number;
  sourcePolicyName: string;
  rules: ReusablePolicyRules;
  overrides: TaskPolicyOverrides;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function validatePolicyRules(input: ReusablePolicyRulesInput | ReusablePolicyRules): ReusablePolicyRules {
  const parsed = reusablePolicyRulesSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApplicationError("VALIDATION_ERROR", "Policy validation failed.", 400, parsed.error.flatten());
  }
  const rules = {
    ...parsed.data,
    allowedProviders: unique(parsed.data.allowedProviders),
    blockedProviders: unique(parsed.data.blockedProviders),
    allowedNetworks: unique(parsed.data.allowedNetworks),
    allowedMints: unique(parsed.data.allowedMints),
    allowedProtocols: [...new Set(parsed.data.allowedProtocols)],
  };
  const total = parseUsdc(rules.totalCeilingUsd);
  const perCall = parseUsdc(rules.maxPerCallUsd);
  if (total <= 0n) throw new ApplicationError("VALIDATION_ERROR", "Policy total ceiling must be greater than zero.", 400);
  if (perCall <= 0n) throw new ApplicationError("VALIDATION_ERROR", "Policy per-call ceiling must be greater than zero.", 400);
  if (perCall > total) throw new ApplicationError("VALIDATION_ERROR", "Per-call ceiling cannot exceed the total task ceiling.", 400);

  const allowed = new Set(rules.allowedProviders);
  const blocked = new Set(rules.blockedProviders);
  const conflict = rules.allowedProviders.find((id) => blocked.has(id));
  if (conflict) {
    throw new ApplicationError("VALIDATION_ERROR", `Provider ${conflict} cannot be both allowed and blocked.`, 400);
  }
  for (const [providerId, value] of Object.entries(rules.providerCapsUsd)) {
    if (!allowed.has(providerId)) {
      throw new ApplicationError("VALIDATION_ERROR", `Provider cap ${providerId} must reference an allowed provider.`, 400);
    }
    if (blocked.has(providerId)) {
      throw new ApplicationError("VALIDATION_ERROR", `Blocked provider ${providerId} cannot have a spending cap.`, 400);
    }
    const cap = parseUsdc(value);
    if (cap <= 0n) throw new ApplicationError("VALIDATION_ERROR", `Provider cap ${providerId} must be greater than zero.`, 400);
    if (cap > total) throw new ApplicationError("VALIDATION_ERROR", `Provider cap ${providerId} cannot exceed the total task ceiling.`, 400);
  }

  const effectiveCapacity = rules.allowedProviders.reduce((sum, providerId) => {
    const cap = rules.providerCapsUsd[providerId];
    return sum + (cap ? parseUsdc(cap) : total);
  }, 0n);
  if (effectiveCapacity < total) {
    throw new ApplicationError("VALIDATION_ERROR", "Provider caps cannot collectively cover the policy's total task ceiling.", 400);
  }
  return rules;
}

export function parseReusablePolicyCreate(input: unknown) {
  const parsed = reusablePolicyCreateSchema.safeParse(input);
  if (!parsed.success) throw new ApplicationError("VALIDATION_ERROR", "Policy request validation failed.", 400, parsed.error.flatten());
  return { ...parsed.data, rules: validatePolicyRules(parsed.data.rules) };
}

export function parseReusablePolicyUpdate(input: unknown) {
  const parsed = reusablePolicyUpdateSchema.safeParse(input);
  if (!parsed.success) throw new ApplicationError("VALIDATION_ERROR", "Policy update validation failed.", 400, parsed.error.flatten());
  return { ...parsed.data, ...(parsed.data.rules ? { rules: validatePolicyRules(parsed.data.rules) } : {}) };
}

export function parseTaskPolicyOverrides(input: unknown): TaskPolicyOverrides {
  const parsed = taskPolicyOverrideSchema.safeParse(input ?? {});
  if (!parsed.success) throw new ApplicationError("VALIDATION_ERROR", "Task policy overrides are invalid.", 400, parsed.error.flatten());
  return parsed.data;
}

export function mergePolicyRules(base: ReusablePolicyRules, overrides: TaskPolicyOverrides): ReusablePolicyRules {
  return validatePolicyRules({ ...base, ...overrides });
}

export function policyId(): string {
  return `policy_${randomUUID()}`;
}

export function protocolForMode(mode: ProviderMode): PolicyProtocol {
  return mode === "deterministic" ? "demo" : mode;
}

export function policySupportsTaskMode(rules: ReusablePolicyRules, mode: ProviderMode): boolean {
  return rules.allowedProtocols.includes(protocolForMode(mode));
}

export function humanPolicySummary(rules: ReusablePolicyRules): string[] {
  const providerCaps = Object.keys(rules.providerCapsUsd).length;
  return [
    `${rules.totalCeilingUsd} USDC total ceiling`,
    `${rules.maxPerCallUsd} USDC max per call`,
    `${rules.allowedProviders.length} allowed provider${rules.allowedProviders.length === 1 ? "" : "s"}`,
    `${rules.durationMinutes} minute spending window`,
    `${rules.allowedProtocols.map((value) => value.toUpperCase()).join(" / ")} protocol${rules.allowedProtocols.length === 1 ? "" : "s"}`,
    providerCaps ? `${providerCaps} provider-specific cap${providerCaps === 1 ? "" : "s"}` : "No provider-specific caps",
  ];
}
