export type TaskStatus = "draft" | "active" | "completed" | "cancelled" | "archived";

export type Budget = {
  mint: string;
  totalAtomic: bigint;
};

export type Policy = {
  allowedProviderIds: readonly string[];
  maxPerCallAtomic?: bigint;
  providerCapsAtomic?: Readonly<Record<string, bigint>>;
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
};

export type PolicyRejectionCode =
  | "TASK_NOT_ACTIVE"
  | "TASK_EXPIRED"
  | "INVALID_AMOUNT"
  | "PROVIDER_NOT_ALLOWED"
  | "PER_CALL_CAP_EXCEEDED"
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
