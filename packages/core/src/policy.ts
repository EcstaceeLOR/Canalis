import type {
  PolicyDecision,
  SpendProposal,
  TaskLedger,
} from "./domain.js";

function reject(
  code: Extract<PolicyDecision, { allowed: false }>["code"],
  message: string,
): PolicyDecision {
  return { allowed: false, code, message };
}

export function evaluateSpend(proposal: SpendProposal): PolicyDecision {
  const {
    task,
    ledger,
    providerId,
    quotedAmountAtomic,
    currentProviderCumulativeAtomic,
    nextProviderCumulativeAtomic,
    channelCeilingAtomic,
    nowUnixSeconds,
    mint,
    network,
    protocol,
  } = proposal;

  if (ledger.taskId !== task.id) {
    return reject(
      "LEDGER_TASK_MISMATCH",
      "The supplied ledger does not belong to this task.",
    );
  }

  if (task.status !== "active") {
    return reject("TASK_NOT_ACTIVE", "The task is not active.");
  }

  if (
    task.expiresAtUnixSeconds !== 0n &&
    nowUnixSeconds >= task.expiresAtUnixSeconds
  ) {
    return reject("TASK_EXPIRED", "The task spending window has expired.");
  }

  if (quotedAmountAtomic <= 0n) {
    return reject("INVALID_AMOUNT", "A paid flow must have a positive amount.");
  }

  if (task.policy.blockedProviderIds?.includes(providerId)) {
    return reject("PROVIDER_BLOCKED", "The provider is explicitly blocked by this task policy.");
  }

  if (!task.policy.allowedProviderIds.includes(providerId)) {
    return reject(
      "PROVIDER_NOT_ALLOWED",
      "The provider is not allowed by this task policy.",
    );
  }

  if (mint && task.policy.allowedMints?.length && !task.policy.allowedMints.includes(mint)) {
    return reject("MINT_NOT_ALLOWED", `The quoted asset ${mint} is not allowed by this task policy.`);
  }

  if (protocol && task.policy.allowedProtocols?.length && !task.policy.allowedProtocols.includes(protocol)) {
    return reject("PROTOCOL_NOT_ALLOWED", `The ${protocol} protocol is not allowed by this task policy.`);
  }

  if (task.policy.allowedNetworks?.length) {
    if (!network || !task.policy.allowedNetworks.includes(network)) {
      return reject(
        "NETWORK_NOT_ALLOWED",
        network
          ? `The provider network ${network} is not allowed by this task policy.`
          : "The provider quote does not declare a network required by this task policy.",
      );
    }
  }

  const perCallCap = task.policy.maxPerCallAtomic;
  if (perCallCap !== undefined && quotedAmountAtomic > perCallCap) {
    return reject(
      "PER_CALL_CAP_EXCEEDED",
      "The quoted amount exceeds the task's per-call cap.",
    );
  }

  if (nextProviderCumulativeAtomic <= currentProviderCumulativeAtomic) {
    return reject(
      "NON_MONOTONIC_VOUCHER",
      "The provider cumulative voucher amount must increase.",
    );
  }

  const voucherDelta =
    nextProviderCumulativeAtomic - currentProviderCumulativeAtomic;
  if (voucherDelta !== quotedAmountAtomic) {
    return reject(
      "VOUCHER_DELTA_MISMATCH",
      "The cumulative voucher increase does not match the quoted amount.",
    );
  }

  if (nextProviderCumulativeAtomic > channelCeilingAtomic) {
    return reject(
      "CHANNEL_CEILING_EXCEEDED",
      "The proposed cumulative voucher exceeds the provider channel ceiling.",
    );
  }

  const currentProviderSpend = ledger.providerSpentAtomic[providerId] ?? 0n;
  const projectedProviderSpend = currentProviderSpend + quotedAmountAtomic;
  const providerCap = task.policy.providerCapsAtomic?.[providerId];
  if (providerCap !== undefined && projectedProviderSpend > providerCap) {
    return reject(
      "PROVIDER_CAP_EXCEEDED",
      "The proposed spend exceeds this provider's task-level cap.",
    );
  }

  const projectedTaskSpend = ledger.spentAtomic + quotedAmountAtomic;
  if (projectedTaskSpend > task.budget.totalAtomic) {
    return reject(
      "TASK_BUDGET_EXCEEDED",
      "The proposed spend exceeds the task's approved total budget.",
    );
  }

  return {
    allowed: true,
    amountAtomic: quotedAmountAtomic,
    projectedTaskSpendAtomic: projectedTaskSpend,
    projectedProviderSpendAtomic: projectedProviderSpend,
    nextProviderCumulativeAtomic,
  };
}

export function applyApprovedSpend(
  ledger: TaskLedger,
  providerId: string,
  decision: PolicyDecision,
): TaskLedger {
  if (!decision.allowed) {
    throw new Error(`cannot apply rejected policy decision: ${decision.code}`);
  }

  return {
    taskId: ledger.taskId,
    spentAtomic: decision.projectedTaskSpendAtomic,
    providerSpentAtomic: {
      ...ledger.providerSpentAtomic,
      [providerId]: decision.projectedProviderSpendAtomic,
    },
  };
}
