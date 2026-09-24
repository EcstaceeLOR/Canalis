import type { SignatureBytes } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  finalizeProviderChannel,
  finalizeTaskChannels,
  solanaExplorerTransactionUrl,
  type ChannelDescriptor,
  type DistributionResult,
  type OpenChannelRequest,
  type PaymentChannelAdapter,
  type SettleChannelRequest,
  type SettlementResult,
} from "../src/index.js";

const voucherSignature = new Uint8Array(64) as SignatureBytes;

class FakePaymentChannelAdapter implements PaymentChannelAdapter {
  readonly channels = new Map<string, ChannelDescriptor>();
  readonly calls: string[] = [];
  readonly failSettle = new Set<string>();
  readonly failDistribute = new Set<string>();
  readonly distributionOverrides = new Map<string, DistributionResult>();

  constructor(channels: readonly ChannelDescriptor[]) {
    for (const channel of channels) {
      this.channels.set(channel.channelAddress, { ...channel });
    }
  }

  async open(request: OpenChannelRequest): Promise<ChannelDescriptor> {
    const channelAddress = `channel-${this.channels.size + 1}`;
    const channel: ChannelDescriptor = {
      channelAddress,
      payer: request.payer,
      payee: request.payee,
      mint: request.mint,
      authorizedSigner: request.authorizedSigner,
      depositCeiling: request.depositCeiling,
      settledAmount: 0n,
      state: "open",
    };
    this.channels.set(channelAddress, channel);
    return { ...channel };
  }

  async settle(request: SettleChannelRequest): Promise<SettlementResult> {
    this.calls.push(`settle:${request.channelAddress}`);
    const channel = this.requireChannel(request.channelAddress);
    channel.settledAmount = request.cumulativeAmount;
    return {
      channelAddress: request.channelAddress,
      settledAmount: request.cumulativeAmount,
      transactionSignature: `settle-${request.channelAddress}`,
    };
  }

  async settleAndSeal(request: SettleChannelRequest): Promise<SettlementResult> {
    this.calls.push(`settleAndSeal:${request.channelAddress}`);
    if (this.failSettle.has(request.channelAddress)) {
      throw new Error("simulated settle failure");
    }
    const channel = this.requireChannel(request.channelAddress);
    channel.settledAmount = request.cumulativeAmount;
    channel.state = "sealed";
    return {
      channelAddress: request.channelAddress,
      settledAmount: request.cumulativeAmount,
      transactionSignature: `settle-${request.channelAddress}`,
    };
  }

  async sealCurrent(channelAddress: string): Promise<SettlementResult> {
    this.calls.push(`sealCurrent:${channelAddress}`);
    if (this.failSettle.has(channelAddress)) {
      throw new Error("simulated seal failure");
    }
    const channel = this.requireChannel(channelAddress);
    channel.state = "sealed";
    return {
      channelAddress,
      settledAmount: channel.settledAmount,
      transactionSignature: `seal-${channelAddress}`,
    };
  }

  async distribute(channelAddress: string): Promise<DistributionResult> {
    this.calls.push(`distribute:${channelAddress}`);
    if (this.failDistribute.has(channelAddress)) {
      throw new Error("simulated distribute failure");
    }
    const override = this.distributionOverrides.get(channelAddress);
    if (override) return { ...override };

    const channel = this.requireChannel(channelAddress);
    channel.state = "distributed";
    return {
      channelAddress,
      providerAmount: channel.settledAmount,
      payerRefund: channel.depositCeiling - channel.settledAmount,
      transactionSignature: `distribute-${channelAddress}`,
    };
  }

  async withdrawPayer(channelAddress: string): Promise<DistributionResult> {
    this.calls.push(`withdrawPayer:${channelAddress}`);
    const channel = this.requireChannel(channelAddress);
    return {
      channelAddress,
      providerAmount: channel.settledAmount,
      payerRefund: channel.depositCeiling - channel.settledAmount,
      transactionSignature: `withdraw-${channelAddress}`,
    };
  }

  async getChannel(channelAddress: string): Promise<ChannelDescriptor | null> {
    this.calls.push(`get:${channelAddress}`);
    const channel = this.channels.get(channelAddress);
    return channel ? { ...channel } : null;
  }

  private requireChannel(channelAddress: string): ChannelDescriptor {
    const channel = this.channels.get(channelAddress);
    if (!channel) throw new Error(`unknown channel: ${channelAddress}`);
    return channel;
  }
}

function channel(
  channelAddress: string,
  depositCeiling: bigint,
  settledAmount = 0n,
  state: ChannelDescriptor["state"] = "open",
): ChannelDescriptor {
  return {
    channelAddress,
    payer: "payer",
    payee: `payee-${channelAddress}`,
    mint: "USDC",
    authorizedSigner: "authorizer",
    depositCeiling,
    settledAmount,
    state,
  };
}

function finalVoucher() {
  return { expiresAt: 9_999_999n, voucherSignature };
}

describe("Solana explorer links", () => {
  it("builds cluster-aware transaction URLs", () => {
    expect(solanaExplorerTransactionUrl("abc123", "devnet")).toBe(
      "https://explorer.solana.com/tx/abc123?cluster=devnet",
    );
    expect(solanaExplorerTransactionUrl("abc123", "mainnet-beta")).toBe(
      "https://explorer.solana.com/tx/abc123",
    );
  });
});

describe("finalizeProviderChannel", () => {
  it("settles the final voucher, distributes authorized spend, and refunds unused escrow", async () => {
    const adapter = new FakePaymentChannelAdapter([channel("search-channel", 100_000n)]);

    const result = await finalizeProviderChannel(adapter, {
      providerId: "search",
      channelAddress: "search-channel",
      depositCeilingAtomic: 100_000n,
      authorizedCumulativeAtomic: 50_000n,
      finalVoucher: finalVoucher(),
    });

    expect(result.status).toBe("finalized");
    expect(result.providerAmountAtomic).toBe(50_000n);
    expect(result.payerRefundAtomic).toBe(50_000n);
    expect(result.settlementTransactionSignature).toBe("settle-search-channel");
    expect(result.distributionTransactionSignature).toBe("distribute-search-channel");
    expect(result.distributionExplorerUrl).toContain("cluster=devnet");
    expect(adapter.calls).toEqual([
      "get:search-channel",
      "settleAndSeal:search-channel",
      "distribute:search-channel",
    ]);
  });

  it("cooperatively seals a zero-spend channel without inventing a voucher", async () => {
    const adapter = new FakePaymentChannelAdapter([channel("unused-channel", 80_000n)]);

    const result = await finalizeProviderChannel(adapter, {
      providerId: "unused",
      channelAddress: "unused-channel",
      depositCeilingAtomic: 80_000n,
      authorizedCumulativeAtomic: 0n,
    });

    expect(result.status).toBe("finalized");
    expect(result.providerAmountAtomic).toBe(0n);
    expect(result.payerRefundAtomic).toBe(80_000n);
    expect(adapter.calls).toContain("sealCurrent:unused-channel");
    expect(adapter.calls).not.toContain("settleAndSeal:unused-channel");
  });

  it("can resume from an already-sealed channel by distributing only", async () => {
    const adapter = new FakePaymentChannelAdapter([
      channel("sealed-channel", 100_000n, 40_000n, "sealed"),
    ]);

    const result = await finalizeProviderChannel(adapter, {
      providerId: "search",
      channelAddress: "sealed-channel",
      depositCeilingAtomic: 100_000n,
      authorizedCumulativeAtomic: 40_000n,
    });

    expect(result.status).toBe("finalized");
    expect(result.providerAmountAtomic).toBe(40_000n);
    expect(result.payerRefundAtomic).toBe(60_000n);
    expect(result.settlementTransactionSignature).toBeUndefined();
    expect(adapter.calls).toEqual([
      "get:sealed-channel",
      "distribute:sealed-channel",
    ]);
  });

  it("returns an explicit retry path when final settlement fails", async () => {
    const adapter = new FakePaymentChannelAdapter([channel("failed-settle", 100_000n)]);
    adapter.failSettle.add("failed-settle");

    const result = await finalizeProviderChannel(adapter, {
      providerId: "search",
      channelAddress: "failed-settle",
      depositCeilingAtomic: 100_000n,
      authorizedCumulativeAtomic: 50_000n,
      finalVoucher: finalVoucher(),
    });

    expect(result.status).toBe("recovery-required");
    expect(result.failedPhase).toBe("settle-and-seal");
    expect(result.recoveryAction).toBe("retry-settle-and-seal");
    expect(result.providerAmountAtomic).toBe(0n);
    expect(result.payerRefundAtomic).toBe(0n);
  });

  it("preserves the settlement transaction when distribution needs retry", async () => {
    const adapter = new FakePaymentChannelAdapter([channel("failed-distribute", 100_000n)]);
    adapter.failDistribute.add("failed-distribute");

    const result = await finalizeProviderChannel(adapter, {
      providerId: "search",
      channelAddress: "failed-distribute",
      depositCeilingAtomic: 100_000n,
      authorizedCumulativeAtomic: 50_000n,
      finalVoucher: finalVoucher(),
    });

    expect(result.status).toBe("recovery-required");
    expect(result.failedPhase).toBe("distribute");
    expect(result.recoveryAction).toBe("retry-distribute");
    expect(result.settlementTransactionSignature).toBe("settle-failed-distribute");
    expect(result.settlementExplorerUrl).toContain("settle-failed-distribute");
  });

  it("refuses to call a mismatched distribution reconciled", async () => {
    const adapter = new FakePaymentChannelAdapter([channel("bad-distribution", 100_000n)]);
    adapter.distributionOverrides.set("bad-distribution", {
      channelAddress: "bad-distribution",
      providerAmount: 60_000n,
      payerRefund: 40_000n,
      transactionSignature: "bad-distribution-tx",
    });

    const result = await finalizeProviderChannel(adapter, {
      providerId: "search",
      channelAddress: "bad-distribution",
      depositCeilingAtomic: 100_000n,
      authorizedCumulativeAtomic: 50_000n,
      finalVoucher: finalVoucher(),
    });

    expect(result.status).toBe("recovery-required");
    expect(result.failedPhase).toBe("reconcile");
    expect(result.recoveryAction).toBe("inspect-channel");
    expect(result.providerAmountAtomic).toBe(60_000n);
    expect(result.payerRefundAtomic).toBe(40_000n);
  });

  it("surfaces forced-close grace as a distinct recovery state", async () => {
    const adapter = new FakePaymentChannelAdapter([
      channel("closing-channel", 100_000n, 50_000n, "closing"),
    ]);

    const result = await finalizeProviderChannel(adapter, {
      providerId: "search",
      channelAddress: "closing-channel",
      depositCeilingAtomic: 100_000n,
      authorizedCumulativeAtomic: 50_000n,
    });

    expect(result.status).toBe("recovery-required");
    expect(result.recoveryAction).toBe("wait-for-forced-close");
  });
});

describe("finalizeTaskChannels", () => {
  it("reconciles provider payouts, channel refunds, and unreserved task budget", async () => {
    const adapter = new FakePaymentChannelAdapter([
      channel("search", 100_000n),
      channel("data", 80_000n),
      channel("inference", 120_000n),
    ]);

    const result = await finalizeTaskChannels(adapter, {
      taskId: "task-1",
      taskBudgetAtomic: 350_000n,
      cluster: "devnet",
      channels: [
        {
          providerId: "search",
          channelAddress: "search",
          depositCeilingAtomic: 100_000n,
          authorizedCumulativeAtomic: 50_000n,
          finalVoucher: finalVoucher(),
        },
        {
          providerId: "data",
          channelAddress: "data",
          depositCeilingAtomic: 80_000n,
          authorizedCumulativeAtomic: 30_000n,
          finalVoucher: finalVoucher(),
        },
        {
          providerId: "inference",
          channelAddress: "inference",
          depositCeilingAtomic: 120_000n,
          authorizedCumulativeAtomic: 120_000n,
          finalVoucher: finalVoucher(),
        },
      ],
    });

    expect(result.reservedCeilingAtomic).toBe(300_000n);
    expect(result.unreservedBudgetAtomic).toBe(50_000n);
    expect(result.authorizedSpendAtomic).toBe(200_000n);
    expect(result.providerPaidAtomic).toBe(200_000n);
    expect(result.channelRefundAtomic).toBe(100_000n);
    expect(result.totalRecoveredAtomic).toBe(150_000n);
    expect(result.reconciledAtomic).toBe(350_000n);
    expect(result.unresolvedEscrowAtomic).toBe(0n);
    expect(result.isFullyFinalized).toBe(true);
    expect(result.isReconciled).toBe(true);
    expect(result.finalizedChannelCount).toBe(3);
    expect(result.recoveryRequiredChannelCount).toBe(0);
  });

  it("does not report reconciliation while one channel still needs recovery", async () => {
    const adapter = new FakePaymentChannelAdapter([
      channel("search", 100_000n),
      channel("data", 80_000n),
    ]);
    adapter.failDistribute.add("data");

    const result = await finalizeTaskChannels(adapter, {
      taskId: "task-partial",
      taskBudgetAtomic: 200_000n,
      channels: [
        {
          providerId: "search",
          channelAddress: "search",
          depositCeilingAtomic: 100_000n,
          authorizedCumulativeAtomic: 50_000n,
          finalVoucher: finalVoucher(),
        },
        {
          providerId: "data",
          channelAddress: "data",
          depositCeilingAtomic: 80_000n,
          authorizedCumulativeAtomic: 30_000n,
          finalVoucher: finalVoucher(),
        },
      ],
    });

    expect(result.isFullyFinalized).toBe(false);
    expect(result.isReconciled).toBe(false);
    expect(result.recoveryRequiredChannelCount).toBe(1);
    expect(result.unresolvedEscrowAtomic).toBe(80_000n);
    expect(result.channels.find((item) => item.providerId === "data")?.recoveryAction).toBe(
      "retry-distribute",
    );
  });
});
