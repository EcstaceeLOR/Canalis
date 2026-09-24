import type { SignatureBytes } from "@solana/kit";

export type ChannelLifecycleState =
  | "opening"
  | "open"
  | "closing"
  | "sealed"
  | "distributed"
  | "reclaimed";

export type ChannelDescriptor = {
  channelAddress: string;
  payer: string;
  payee: string;
  mint: string;
  authorizedSigner: string;
  depositCeiling: bigint;
  settledAmount: bigint;
  state: ChannelLifecycleState;
};

export type OpenChannelRequest = {
  payer: string;
  payee: string;
  mint: string;
  authorizedSigner: string;
  depositCeiling: bigint;
  gracePeriodSeconds: number;
  salt: bigint;
};

export type SettleChannelRequest = {
  channelAddress: string;
  cumulativeAmount: bigint;
  expiresAt: bigint;
  voucherSignature: SignatureBytes;
};

export type SettlementResult = {
  channelAddress: string;
  settledAmount: bigint;
  transactionSignature: string;
};

export type DistributionResult = {
  channelAddress: string;
  providerAmount: bigint;
  payerRefund: bigint;
  transactionSignature: string;
};

/**
 * Blockchain boundary used by Canalis core. The concrete implementation is
 * responsible for talking to Solana's canonical payment-channels program.
 */
export interface PaymentChannelAdapter {
  open(request: OpenChannelRequest): Promise<ChannelDescriptor>;
  settle(request: SettleChannelRequest): Promise<SettlementResult>;
  settleAndSeal(request: SettleChannelRequest): Promise<SettlementResult>;
  distribute(channelAddress: string): Promise<DistributionResult>;
  withdrawPayer(channelAddress: string): Promise<DistributionResult>;
  getChannel(channelAddress: string): Promise<ChannelDescriptor | null>;
}
