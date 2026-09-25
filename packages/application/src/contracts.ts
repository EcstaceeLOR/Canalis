import { z } from "zod";
import { ApplicationError } from "./errors.js";

export const deterministicProviderIds = ["search", "data", "inference"] as const;
export type DeterministicProviderId = (typeof deterministicProviderIds)[number];
export const providerProtocols = ["demo", "x402", "mpp"] as const;
export const providerModes = ["deterministic", "x402", "mpp"] as const;
export const providerHealthStatuses = ["unknown", "healthy", "unhealthy"] as const;
export type ProviderMode = (typeof providerModes)[number];
export type ProviderProtocol = (typeof providerProtocols)[number];
export type ProviderHealthStatus = (typeof providerHealthStatuses)[number];

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = Record<string, any>;

const idSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase provider slug such as market-data.");
const atomicSchema = z.string().trim().regex(/^\d+$/, "Use an integer atomic amount.");
const moneySchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, "Use a non-negative USDC amount with at most 6 decimals.");
const stringList = z.array(z.string().trim().min(1).max(160)).min(1).max(20);

export const providerPricingSchema = z
  .object({
    kind: z.enum(["fixed-per-call", "metered", "external"]),
    amountAtomic: atomicSchema.optional(),
    mint: z.string().trim().min(1).max(128),
    unit: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((pricing, ctx) => {
    if (pricing.kind === "fixed-per-call" && (!pricing.amountAtomic || BigInt(pricing.amountAtomic) <= 0n)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountAtomic"],
        message: "Fixed pricing requires a positive atomic amount.",
      });
    }
  });

const providerFields = {
  name: z.string().trim().min(2).max(120),
  payee: z.string().trim().min(1).max(200),
  protocol: z.enum(providerProtocols),
  mode: z.enum(providerModes),
  description: z.string().trim().min(1).max(500),
  endpoint: z.string().trim().url().max(500).optional(),
  enabled: z.boolean().default(true),
  supportedAssets: stringList,
  supportedNetworks: stringList,
  pricingModel: providerPricingSchema,
  defaultChannelCeilingAtomic: atomicSchema.optional(),
  secretHeaders: z.record(z.string().trim().min(1).max(120), z.string().max(2_000)).optional(),
} as const;

function validateProviderCombination(
  value: {
    protocol?: ProviderProtocol;
    mode?: ProviderMode;
    endpoint?: string;
    pricingModel?: z.infer<typeof providerPricingSchema>;
    defaultChannelCeilingAtomic?: string;
  },
  ctx: z.RefinementCtx,
) {
  if (value.protocol && value.mode) {
    const expectedMode: ProviderMode = value.protocol === "demo" ? "deterministic" : value.protocol;
    if (value.mode !== expectedMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mode"],
        message: `${value.protocol} providers must use ${expectedMode} mode.`,
      });
    }
  }
  if (value.protocol && value.protocol !== "demo" && !value.endpoint) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoint"],
      message: "Protocol-backed providers require an HTTPS endpoint.",
    });
  }
  if (value.endpoint && !value.endpoint.startsWith("https://")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoint"],
      message: "Provider endpoints must use HTTPS.",
    });
  }
  if (
    value.defaultChannelCeilingAtomic &&
    value.pricingModel?.amountAtomic &&
    BigInt(value.defaultChannelCeilingAtomic) < BigInt(value.pricingModel.amountAtomic)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultChannelCeilingAtomic"],
      message: "Default channel ceiling cannot be below the fixed per-call price.",
    });
  }
}

export const createProviderRequestSchema = z
  .object({ id: idSchema, ...providerFields })
  .strict()
  .superRefine(validateProviderCombination);

export const updateProviderRequestSchema = z
  .object({
    name: providerFields.name.optional(),
    payee: providerFields.payee.optional(),
    protocol: providerFields.protocol.optional(),
    mode: providerFields.mode.optional(),
    description: providerFields.description.optional(),
    endpoint: providerFields.endpoint.nullable().optional(),
    enabled: z.boolean().optional(),
    supportedAssets: providerFields.supportedAssets.optional(),
    supportedNetworks: providerFields.supportedNetworks.optional(),
    pricingModel: providerFields.pricingModel.optional(),
    defaultChannelCeilingAtomic: providerFields.defaultChannelCeilingAtomic.nullable().optional(),
    secretHeaders: providerFields.secretHeaders.optional(),
    clearSecrets: z.boolean().optional(),
  })
  .strict();

export type CreateProviderRequest = z.input<typeof createProviderRequestSchema>;
export type UpdateProviderRequest = z.input<typeof updateProviderRequestSchema>;

export type ProviderDto = {
  id: string;
  name: string;
  payee: string;
  protocol: ProviderProtocol;
  mode: ProviderMode;
  description: string;
  endpoint?: string;
  enabled: boolean;
  supportedAssets: string[];
  supportedNetworks: string[];
  pricingModel: z.infer<typeof providerPricingSchema>;
  defaultChannelCeilingAtomic?: string;
  health: {
    status: ProviderHealthStatus;
    message?: string;
    lastCheckedAt?: string;
    lastSuccessAt?: string;
    lastErrorAt?: string;
    lastError?: string;
  };
  secrets: {
    configured: boolean;
    keys: string[];
  };
  usage: {
    tasks: number;
    channels: number;
    flows: number;
  };
};

export const createTaskRequestSchema = z
  .object({
    owner: z.string().trim().min(1).max(128).default("demo-owner"),
    agentId: z.string().trim().min(1).max(128).default("canalis-research-agent"),
    budgetUsd: moneySchema.default("1.00"),
    maxPerCallUsd: moneySchema.default("0.25"),
    allowedProviders: z
      .array(idSchema)
      .min(1)
      .max(12)
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
