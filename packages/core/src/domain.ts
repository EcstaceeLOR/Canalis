export type TaskStatus = "draft" | "active" | "completed" | "cancelled" | "archived";

export type Budget = {
  mint: string;
  totalAtomic: bigint;
};

export type Policy = {
  allowedProviderIds: readonly string[];
  blockedProviderIds?: readonly string[];
  maxPerCallAtomic?: bigint;
  providerCapsAtomic?: Readonly<Record<string, bigint>>;
  allowedNetworks?: readonly string[];
  allowedMints?: readonly string[];
  allowedProtocols?: readonly string[];
  sourcePolicyId?: string;
  sourcePolicyVersion?: number;
  sourcePolicyName?: string;
  overrides?: Readonly<Record<string, unknown>>;
};

export type Task = {
  id: string;
  owner: string;
  agentId: string;
  budget: Budget;
  policy: Policy;
  status: TaskStatus;
  createdAtUnixSeconds: bigint;
  expiresAtUnixSeconds: bigint;
};

export type TaskLedger = {
  taskId: string;
  spentAtomic: bigint;
  providerSpentAtomic: Readonly<Record<string, bigint>>;
};

export type SpendProposal = {
  task: Task;
  ledger: TaskLedger;
  providerId: string;
  quotedAmountAtomic: bigint;
  currentProviderCumulativeAtomic: bigint;
  nextProviderCumulativeAtomic: bigint;
  channelCeilingAtomic: bigint;
  nowUnixSeconds: bigint;
  mint?: string;
  network?: string;
  protocol?: string;
};

export type PolicyRejectionCode =
  | "TASK_NOT_ACTIVE"
  | "TASK_EXPIRED"
  | "INVALID_AMOUNT"
  | "PROVIDER_NOT_ALLOWED"
  | "PROVIDER_BLOCKED"
  | "PER_CALL_CAP_EXCEEDED"
  | "NETWORK_NOT_ALLOWED"
  | "MINT_NOT_ALLOWED"
  | "PROTOCOL_NOT_ALLOWED"
  | "NON_MONOTONIC_VOUCHER"
  | "VOUCHER_DELTA_MISMATCH"
  | "CHANNEL_CEILING_EXCEEDED"
  | "PROVIDER_CAP_EXCEEDED"
  | "TASK_BUDGET_EXCEEDED"
  | "LEDGER_TASK_MISMATCH";

export type PolicyDecision =
  | {
      allowed: true;
      amountAtomic: bigint;
      projectedTaskSpendAtomic: bigint;
      projectedProviderSpendAtomic: bigint;
      nextProviderCumulativeAtomic: bigint;
    }
  | {
      allowed: false;
      code: PolicyRejectionCode;
      message: string;
    };
