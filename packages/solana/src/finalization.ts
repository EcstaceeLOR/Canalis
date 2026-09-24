import type { SignatureBytes } from "@solana/kit";
import type {
  ChannelDescriptor,
  DistributionResult,
  PaymentChannelAdapter,
  SettlementResult,
} from "./types.js";

export type SolanaExplorerCluster = "mainnet-beta" | "devnet" | "testnet";

export type FinalVoucherAuthorization = {
  expiresAt: bigint;
  voucherSignature: SignatureBytes;
};

export type ChannelFinalizationInput = {
  providerId: string;
  channelAddress: string;
  depositCeilingAtomic: bigint;
  authorizedCumulativeAtomic: bigint;
  finalVoucher?: FinalVoucherAuthorization;
};

export type ChannelFinalizationFailurePhase =
  | "inspect"
  | "settle-and-seal"
  | "distribute"
  | "reconcile";

export type ChannelRecoveryAction =
  | "inspect-channel"
  | "retry-settle-and-seal"
  | "retry-distribute"
  | "wait-for-forced-close";

export type ChannelFinalizationRecord = {
  providerId: string;
  channelAddress: string;
  status: "finalized" | "recovery-required";
  depositCeilingAtomic: bigint;
  authorizedCumulativeAtomic: bigint;
  expectedProviderAmountAtomic: bigint;
  expectedPayerRefundAtomic: bigint;
  providerAmountAtomic: bigint;
  payerRefundAtomic: bigint;
  settlementTransactionSignature?: string;
  distributionTransactionSignature?: string;
  settlementExplorerUrl?: string;
  distributionExplorerUrl?: string;
  failedPhase?: ChannelFinalizationFailurePhase;
  recoveryAction?: ChannelRecoveryAction;
  errorMessage?: string;
};

export type TaskFinalizationSummary = {
  taskId: string;
  cluster: SolanaExplorerCluster;
  taskBudgetAtomic: bigint;
  reservedCeilingAtomic: bigint;
  unreservedBudgetAtomic: bigint;
  authorizedSpendAtomic: bigint;
  providerPaidAtomic: bigint;
  channelRefundAtomic: bigint;
  totalRecoveredAtomic: bigint;
  unresolvedEscrowAtomic: bigint;
  reconciledAtomic: bigint;
  isFullyFinalized: boolean;
  isReconciled: boolean;
  finalizedChannelCount: number;
  recoveryRequiredChannelCount: number;
  channels: ChannelFinalizationRecord[];
};

export type FinalizeTaskChannelsInput = {
  taskId: string;
  taskBudgetAtomic: bigint;
  cluster?: SolanaExplorerCluster;
  channels: readonly ChannelFinalizationInput[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown channel finalization failure";
}

function assertNonNegative(label: string, value: bigint): void {
  if (value < 0n) {
    throw new Error(`${label} must not be negative`);
  }
}

function assertInput(input: ChannelFinalizationInput): void {
  if (!input.providerId.trim()) throw new Error("providerId is required");
  if (!input.channelAddress.trim()) throw new Error("channelAddress is required");
  assertNonNegative("deposit ceiling", input.depositCeilingAtomic);
  assertNonNegative("authorized cumulative amount", input.authorizedCumulativeAtomic);
  if (input.authorizedCumulativeAtomic > input.depositCeilingAtomic) {
    throw new Error("authorized cumulative amount cannot exceed channel deposit ceiling");
  }
}

export function solanaExplorerTransactionUrl(
  signature: string,
  cluster: SolanaExplorerCluster = "devnet",
): string {
  if (!signature.trim()) throw new Error("transaction signature is required");
  const base = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}`;
  return cluster === "mainnet-beta" ? base : `${base}?cluster=${cluster}`;
}

function recoveryRecord(
  input: ChannelFinalizationInput,
  phase: ChannelFinalizationFailurePhase,
  action: ChannelRecoveryAction,
  message: string,
  cluster: SolanaExplorerCluster,
  settlement?: SettlementResult,
): ChannelFinalizationRecord {
  const expectedRefund = input.depositCeilingAtomic - input.authorizedCumulativeAtomic;
  return {
    providerId: input.providerId,
    channelAddress: input.channelAddress,
    status: "recovery-required",
    depositCeilingAtomic: input.depositCeilingAtomic,
    authorizedCumulativeAtomic: input.authorizedCumulativeAtomic,
    expectedProviderAmountAtomic: input.authorizedCumulativeAtomic,
    expectedPayerRefundAtomic: expectedRefund,
    providerAmountAtomic: 0n,
    payerRefundAtomic: 0n,
    settlementTransactionSignature: settlement?.transactionSignature,
    settlementExplorerUrl: settlement?.transactionSignature
      ? solanaExplorerTransactionUrl(settlement.transactionSignature, cluster)
      : undefined,
    failedPhase: phase,
    recoveryAction: action,
    errorMessage: message,
  };
}

function verifyChannelMatchesInput(
  channel: ChannelDescriptor,
  input: ChannelFinalizationInput,
): void {
  if (channel.channelAddress !== input.channelAddress) {
    throw new Error("adapter returned a different channel address");
  }
  if (channel.depositCeiling !== input.depositCeilingAtomic) {
    throw new Error("on-chain channel deposit does not match Canalis reservation");
  }
  if (channel.settledAmount > input.authorizedCumulativeAtomic) {
    throw new Error("on-chain settled amount exceeds Canalis authorized cumulative spend");
  }
}

async function sealAtAuthorizedWatermark(
  adapter: PaymentChannelAdapter,
  channel: ChannelDescriptor,
  input: ChannelFinalizationInput,
): Promise<SettlementResult> {
  if (channel.state === "sealed") {
    if (channel.settledAmount !== input.authorizedCumulativeAtomic) {
      throw new Error("sealed channel watermark does not match Canalis authorization");
    }
    return {
      channelAddress: channel.channelAddress,
      settledAmount: channel.settledAmount,
      transactionSignature: "",
    };
  }

  if (channel.state === "closing") {
    throw new Error("channel is in forced-close grace period");
  }

  if (channel.state !== "open") {
    throw new Error(`channel cannot be finalized from state ${channel.state}`);
  }

  if (channel.settledAmount === input.authorizedCumulativeAtomic) {
    return adapter.sealCurrent(input.channelAddress);
  }

  if (!input.finalVoucher) {
    throw new Error("final voucher is required to advance the settled watermark");
  }

  return adapter.settleAndSeal({
    channelAddress: input.channelAddress,
    cumulativeAmount: input.authorizedCumulativeAtomic,
    expiresAt: input.finalVoucher.expiresAt,
    voucherSignature: input.finalVoucher.voucherSignature,
  });
}

function verifySettlement(
  settlement: SettlementResult,
  input: ChannelFinalizationInput,
): void {
  if (settlement.channelAddress !== input.channelAddress) {
    throw new Error("settlement returned a different channel address");
  }
  if (settlement.settledAmount !== input.authorizedCumulativeAtomic) {
    throw new Error("settlement watermark does not equal authorized cumulative spend");
  }
}

function verifyDistribution(
  distribution: DistributionResult,
  input: ChannelFinalizationInput,
): void {
  if (distribution.channelAddress !== input.channelAddress) {
    throw new Error("distribution returned a different channel address");
  }
  if (distribution.providerAmount !== input.authorizedCumulativeAtomic) {
    throw new Error("provider distribution does not equal authorized cumulative spend");
  }
  const expectedRefund = input.depositCeilingAtomic - input.authorizedCumulativeAtomic;
  if (distribution.payerRefund !== expectedRefund) {
    throw new Error("payer refund does not equal unused channel deposit");
  }
  if (distribution.providerAmount + distribution.payerRefund !== input.depositCeilingAtomic) {
    throw new Error("channel distribution does not reconcile with deposit ceiling");
  }
}

export async function finalizeProviderChannel(
  adapter: PaymentChannelAdapter,
  input: ChannelFinalizationInput,
  cluster: SolanaExplorerCluster = "devnet",
): Promise<ChannelFinalizationRecord> {
  assertInput(input);

  let channel: ChannelDescriptor | null;
  try {
    channel = await adapter.getChannel(input.channelAddress);
    if (!channel) {
      return recoveryRecord(
        input,
        "inspect",
        "inspect-channel",
        "Channel account was not found; confirm whether it was already reclaimed.",
        cluster,
      );
    }
    verifyChannelMatchesInput(channel, input);
  } catch (error) {
    return recoveryRecord(input, "inspect", "inspect-channel", errorMessage(error), cluster);
  }

  if (channel.state === "distributed" || channel.state === "reclaimed") {
    return recoveryRecord(
      input,
      "inspect",
      "inspect-channel",
      "Channel is already terminal but Canalis has no distribution receipt to reconcile.",
      cluster,
    );
  }

  if (channel.state === "closing") {
    return recoveryRecord(
      input,
      "settle-and-seal",
      "wait-for-forced-close",
      "Channel is in forced-close grace period; wait for seal eligibility, then distribute.",
      cluster,
    );
  }

  let settlement: SettlementResult;
  try {
    settlement = await sealAtAuthorizedWatermark(adapter, channel, input);
    verifySettlement(settlement, input);
  } catch (error) {
    return recoveryRecord(
      input,
      "settle-and-seal",
      channel.state === "sealed" ? "inspect-channel" : "retry-settle-and-seal",
      errorMessage(error),
      cluster,
    );
  }

  let distribution: DistributionResult;
  try {
    distribution = await adapter.distribute(input.channelAddress);
  } catch (error) {
    return recoveryRecord(
      input,
      "distribute",
      "retry-distribute",
      errorMessage(error),
      cluster,
      settlement,
    );
  }

  try {
    verifyDistribution(distribution, input);
  } catch (error) {
    const record = recoveryRecord(
      input,
      "reconcile",
      "inspect-channel",
      errorMessage(error),
      cluster,
      settlement,
    );
    record.providerAmountAtomic = distribution.providerAmount;
    record.payerRefundAtomic = distribution.payerRefund;
    record.distributionTransactionSignature = distribution.transactionSignature;
    record.distributionExplorerUrl = solanaExplorerTransactionUrl(
      distribution.transactionSignature,
      cluster,
    );
    return record;
  }

  return {
    providerId: input.providerId,
    channelAddress: input.channelAddress,
    status: "finalized",
    depositCeilingAtomic: input.depositCeilingAtomic,
    authorizedCumulativeAtomic: input.authorizedCumulativeAtomic,
    expectedProviderAmountAtomic: input.authorizedCumulativeAtomic,
    expectedPayerRefundAtomic:
      input.depositCeilingAtomic - input.authorizedCumulativeAtomic,
    providerAmountAtomic: distribution.providerAmount,
    payerRefundAtomic: distribution.payerRefund,
    settlementTransactionSignature: settlement.transactionSignature || undefined,
    distributionTransactionSignature: distribution.transactionSignature,
    settlementExplorerUrl: settlement.transactionSignature
      ? solanaExplorerTransactionUrl(settlement.transactionSignature, cluster)
      : undefined,
    distributionExplorerUrl: solanaExplorerTransactionUrl(
      distribution.transactionSignature,
      cluster,
    ),
  };
}

export async function finalizeTaskChannels(
  adapter: PaymentChannelAdapter,
  input: FinalizeTaskChannelsInput,
): Promise<TaskFinalizationSummary> {
  assertNonNegative("task budget", input.taskBudgetAtomic);
  const cluster = input.cluster ?? "devnet";

  const seenProviders = new Set<string>();
  const seenChannels = new Set<string>();
  let reservedCeilingAtomic = 0n;
  let authorizedSpendAtomic = 0n;

  for (const channel of input.channels) {
    assertInput(channel);
    if (seenProviders.has(channel.providerId)) {
      throw new Error(`duplicate provider finalization: ${channel.providerId}`);
    }
    if (seenChannels.has(channel.channelAddress)) {
      throw new Error(`duplicate channel finalization: ${channel.channelAddress}`);
    }
    seenProviders.add(channel.providerId);
    seenChannels.add(channel.channelAddress);
    reservedCeilingAtomic += channel.depositCeilingAtomic;
    authorizedSpendAtomic += channel.authorizedCumulativeAtomic;
  }

  if (reservedCeilingAtomic > input.taskBudgetAtomic) {
    throw new Error("channel deposit ceilings exceed original task budget");
  }

  const channels: ChannelFinalizationRecord[] = [];
  for (const channel of input.channels) {
    channels.push(await finalizeProviderChannel(adapter, channel, cluster));
  }

  const providerPaidAtomic = channels.reduce(
    (sum, channel) => sum + channel.providerAmountAtomic,
    0n,
  );
  const channelRefundAtomic = channels.reduce(
    (sum, channel) => sum + channel.payerRefundAtomic,
    0n,
  );
  const unresolvedEscrowAtomic = channels
    .filter((channel) => channel.status !== "finalized")
    .reduce((sum, channel) => sum + channel.depositCeilingAtomic, 0n);
  const unreservedBudgetAtomic = input.taskBudgetAtomic - reservedCeilingAtomic;
  const totalRecoveredAtomic = channelRefundAtomic + unreservedBudgetAtomic;
  const reconciledAtomic = providerPaidAtomic + totalRecoveredAtomic;
  const finalizedChannelCount = channels.filter(
    (channel) => channel.status === "finalized",
  ).length;
  const recoveryRequiredChannelCount = channels.length - finalizedChannelCount;
  const isFullyFinalized = recoveryRequiredChannelCount === 0;
  const isReconciled =
    isFullyFinalized &&
    providerPaidAtomic === authorizedSpendAtomic &&
    reconciledAtomic === input.taskBudgetAtomic;

  return {
    taskId: input.taskId,
    cluster,
    taskBudgetAtomic: input.taskBudgetAtomic,
    reservedCeilingAtomic,
    unreservedBudgetAtomic,
    authorizedSpendAtomic,
    providerPaidAtomic,
    channelRefundAtomic,
    totalRecoveredAtomic,
    unresolvedEscrowAtomic,
    reconciledAtomic,
    isFullyFinalized,
    isReconciled,
    finalizedChannelCount,
    recoveryRequiredChannelCount,
    channels,
  };
}
