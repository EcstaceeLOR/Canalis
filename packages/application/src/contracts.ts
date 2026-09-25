import { z } from "zod";
import { ApplicationError } from "./errors.js";

export const deterministicProviderIds = ["search", "data", "inference"] as const;
export type DeterministicProviderId = (typeof deterministicProviderIds)[number];
export type ProviderMode = "deterministic" | "x402" | "mpp";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = Record<string, any>;

const moneySchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, "Use a non-negative USDC amount with at most 6 decimals.");

export const createTaskRequestSchema = z
  .object({
    owner: z.string().trim().min(1).max(128).default("demo-owner"),
    agentId: z.string().trim().min(1).max(128).default("canalis-research-agent"),
    budgetUsd: moneySchema.default("1.00"),
    maxPerCallUsd: moneySchema.default("0.25"),
    allowedProviders: z
      .array(z.enum(deterministicProviderIds))
      .min(1)
      .max(deterministicProviderIds.length)
      .default([...deterministicProviderIds]),
    mode: z.enum(["deterministic", "x402"]).default("deterministic"),
    initialStatus: z.enum(["draft", "active"]).default("active"),
    expiryMinutes: z.coerce.number().int().min(1).max(10_080).default(15),
  })
  .strict();

export type CreateTaskRequest = z.input<typeof createTaskRequestSchema>;
export type ParsedCreateTaskRequest = z.output<typeof createTaskRequestSchema>;

export function parseCreateTaskRequest(input: unknown): ParsedCreateTaskRequest {
  const parsed = createTaskRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Task request validation failed.",
      400,
      parsed.error.flatten(),
    );
  }

  const allowedProviders = [...new Set(parsed.data.allowedProviders)];
  if (allowedProviders.length === 0) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Select at least one provider.",
      400,
    );
  }

  return { ...parsed.data, allowedProviders };
}

export function parseUsdc(value: string): bigint {
  const [whole, fractional = ""] = value.split(".");
  const padded = `${fractional}000000`.slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(padded);
}

export type SerializedReceipt = {
  providerId: string;
  requestId: string;
  mint: string;
  priceAtomic: string;
  protocol: string;
  authorizationId: string;
  paymentReference?: string;
  responseHash: string;
  timestampUnixSeconds: string;
  protocolMetadata?: Record<string, string>;
};

export type SerializedFlow = {
  id: string;
  taskId: string;
  providerId: string;
  requestId: string;
  status: string;
  quotedAmountAtomic: string;
  previousCumulativeAtomic: string;
  nextCumulativeAtomic: string;
  rejectionCode?: string;
  rejectionMessage?: string;
  authorizationId?: string;
  paymentReference?: string;
  receipt?: SerializedReceipt;
  errorMessage?: string;
  settlementTransactionSignature?: string;
  createdAtUnixSeconds: string;
};

export type TaskDetailDto = {
  task: {
    id: string;
    owner: string;
    agentId: string;
    mode: ProviderMode;
    status: string;
    mint: string;
    budgetAtomic: string;
    allowedProviders: readonly string[];
    maxPerCallAtomic?: string;
    createdAtUnixSeconds: string;
    expiresAtUnixSeconds: string;
  };
  graph: {
    taskId: string;
    mint: string;
    budgetAtomic: string;
    spentAtomic: string;
    remainingAtomic: string;
    reservedCeilingAtomic: string;
    providers: Array<{
      providerId: string;
      channelCeilingAtomic: string;
      cumulativeAuthorizedAtomic: string;
      spentAtomic: string;
    }>;
    flows: SerializedFlow[];
    settlements: Array<{
      providerId: string;
      cumulativeAmountAtomic: string;
      transactionSignature: string;
    }>;
  };
  channels: Array<{
    providerId: string;
    programAddress: string;
    network: string;
    channelAddress?: string;
    status: string;
    ceilingAtomic: string;
    cumulativeAuthorizedAtomic: string;
    spentAtomic: string;
    openTransactionSignature?: string;
    settleTransactionSignature?: string;
    distributionTransactionSignature?: string;
    refundTransactionSignature?: string;
    recoveryState?: JsonObject;
  }>;
  settlement: {
    status: "awaiting-onchain-finalization" | "partially-finalized" | "finalized";
    authorizedSpendAtomic: string;
    recoverableAtomic: string;
    transactions: Array<{ providerId: string; transactionSignature: string }>;
  };
};
