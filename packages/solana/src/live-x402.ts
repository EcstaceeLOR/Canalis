import { createHash } from "node:crypto";
import {
  getAccount,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { x402Facilitator } from "@x402/core/facilitator";
import type {
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { UptoSvmScheme as UptoSvmFacilitatorScheme } from "@x402/svm/upto/facilitator";
import { UptoSvmScheme as UptoSvmServerScheme } from "@x402/svm/upto/server";
import { SOLANA_DEVNET_CAIP2 } from "./constants.js";

export const SOLANA_DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const CANALIS_DEVNET_SANDBOX_MINT = "BewPkz9eV7JpKJ2G6VfFpxhFqLtFTnxkoBQTzLRm8ott";
export const CANALIS_DEVNET_TREASURY_OWNER = "4zTeC5mVqWLruDexgU2mV66p9t5vCA9JyiZqdGDUspap";
export const CANALIS_LIVE_SANDBOX_MAX_TASK_ATOMIC = 5_000_000n;

const PUBLIC_DEVNET_SPONSOR_SEED_LABEL = "canalis-cwf-2026-issue-1-devnet-payer";
const RECEIVER_AUTHORIZER_SEED_LABEL = "canalis-live-devnet-receiver-authorizer-v1";
const PROVIDER_SEED_PREFIX = "canalis-live-devnet-provider-v1:";
const MIN_SPONSOR_LAMPORTS = 5_000_000;
const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const NETWORK = SOLANA_DEVNET_CAIP2 as Network;

export const LIVE_PROVIDER_IDS = ["search", "data", "inference"] as const;
export type LiveProviderId = (typeof LIVE_PROVIDER_IDS)[number];

export type LiveChannelPreparation = {
  providerId: LiveProviderId;
  paymentRequired: PaymentRequired;
  providerPayTo: string;
  facilitator: string;
  receiverAuthorizer: string;
  mint: string;
  network: string;
};

export type LiveDepositResult = {
  channelId: string;
  transactionSignature: string;
  expiresAtUnixSeconds: string;
  paymentPayload: PaymentPayload;
};

export type LiveClaimResult = {
  channelId: string;
  transactionSignature: string;
  settledAtomic: string;
  refundedAtomic: string;
};

function seededKeypair(label: string): Keypair {
  return Keypair.fromSeed(createHash("sha256").update(label).digest());
}

function publicDevnetSponsor(): Keypair {
  return seededKeypair(PUBLIC_DEVNET_SPONSOR_SEED_LABEL);
}

function receiverAuthorizer(): Keypair {
  return seededKeypair(RECEIVER_AUTHORIZER_SEED_LABEL);
}

export function liveProviderAddress(providerId: string): string {
  if (!(LIVE_PROVIDER_IDS as readonly string[]).includes(providerId)) {
    throw new Error(`Unsupported live sandbox provider: ${providerId}`);
  }
  return seededKeypair(`${PROVIDER_SEED_PREFIX}${providerId}`).publicKey.toBase58();
}

export function assertLiveSettlementAccounting(ceilingAtomic: bigint, settledAtomic: bigint) {
  if (ceilingAtomic <= 0n) throw new Error("Channel ceiling must be greater than zero.");
  if (settledAtomic < 0n || settledAtomic > ceilingAtomic) {
    throw new Error("Settled amount must be between zero and the channel ceiling.");
  }
  const refundedAtomic = ceilingAtomic - settledAtomic;
  if (settledAtomic + refundedAtomic !== ceilingAtomic) {
    throw new Error("Channel settlement accounting invariant failed.");
  }
  return { settledAtomic, refundedAtomic };
}

function isTransientRpcRateLimit(result: SettleResponse): boolean {
  const transaction = (result as { transaction?: unknown }).transaction;
  const errorMessage = (result as { errorMessage?: unknown }).errorMessage;
  return result.success === false && (transaction === "" || transaction === undefined) && typeof errorMessage === "string" && errorMessage.includes("429");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function settlementTransaction(result: SettleResponse): string {
  const transaction = (result as { transaction?: unknown }).transaction;
  if (!result.success || typeof transaction !== "string" || transaction.length === 0) {
    const reason = (result as { errorReason?: unknown }).errorReason;
    const message = (result as { errorMessage?: unknown }).errorMessage;
    throw new Error(`Solana payment-channel settlement failed${typeof reason === "string" ? ` (${reason})` : ""}: ${typeof message === "string" ? message : "no confirmed transaction returned"}`);
  }
  return transaction;
}

function payloadField(payload: PaymentPayload, key: string): string {
  const value = payload.payload[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Payment payload is missing ${key}.`);
  return value;
}

export function validateLivePaymentPayload(paymentPayload: PaymentPayload, requirements: PaymentRequirements, expectedPayer: string): void {
  if (paymentPayload.x402Version !== 2) throw new Error("Only x402 v2 live channels are supported.");
  if (payloadField(paymentPayload, "from") !== expectedPayer) throw new Error("Payment payload payer does not match the authenticated wallet.");
  const accepted = paymentPayload.accepted;
  for (const field of ["scheme", "network", "asset", "amount", "payTo"] as const) {
    if (accepted[field] !== requirements[field]) throw new Error(`Payment payload accepted.${field} does not match the prepared channel.`);
  }
  if (accepted.maxTimeoutSeconds !== requirements.maxTimeoutSeconds) throw new Error("Payment payload timeout does not match the prepared channel.");
}

export class DevnetX402ChannelGateway {
  private readonly connection: Connection;
  private readonly sponsor = publicDevnetSponsor();
  private readonly authorizer = receiverAuthorizer();
  private readonly facilitator: x402Facilitator;
  private serverScheme: UptoSvmServerScheme;
  private ready: Promise<void> | undefined;

  constructor(private readonly rpcUrl = process.env.SVM_RPC_URL?.trim() || DEFAULT_RPC_URL) {
    this.connection = new Connection(this.rpcUrl, "confirmed");
    this.facilitator = new x402Facilitator();
    this.serverScheme = new UptoSvmServerScheme({ rpcUrl: this.rpcUrl });
  }

  private async initialize(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const genesis = await this.connection.getGenesisHash();
        if (genesis !== SOLANA_DEVNET_GENESIS_HASH) throw new Error(`Refusing to use Canalis public sandbox identities outside Solana devnet. Expected genesis ${SOLANA_DEVNET_GENESIS_HASH}, got ${genesis}.`);
        const sponsorLamports = await this.connection.getBalance(this.sponsor.publicKey, "confirmed");
        if (sponsorLamports < MIN_SPONSOR_LAMPORTS) throw new Error(`Canalis devnet sandbox sponsor ${this.sponsor.publicKey.toBase58()} needs devnet SOL before live channels can be opened.`);
        const mint = await getMint(this.connection, new PublicKey(CANALIS_DEVNET_SANDBOX_MINT), "confirmed", TOKEN_PROGRAM_ID);
        if (mint.decimals !== 6 || mint.mintAuthority?.toBase58() !== this.sponsor.publicKey.toBase58()) throw new Error("Configured Canalis devnet sandbox mint failed authority/decimals verification.");
        await getOrCreateAssociatedTokenAccount(this.connection, this.sponsor, new PublicKey(CANALIS_DEVNET_SANDBOX_MINT), new PublicKey(CANALIS_DEVNET_TREASURY_OWNER), true, "confirmed", undefined, TOKEN_PROGRAM_ID);

        const facilitatorSigner = await createKeyPairSignerFromBytes(this.sponsor.secretKey);
        const authorizerSigner = await createKeyPairSignerFromBytes(this.authorizer.secretKey);
        this.facilitator.register(
          NETWORK,
          new UptoSvmFacilitatorScheme(
            toFacilitatorSvmSigner(facilitatorSigner, { defaultRpcUrl: this.rpcUrl }),
            { maxChannelLifetimeSecs: 3_600 },
          ),
        );
        this.serverScheme = new UptoSvmServerScheme({ receiverAuthorizerSigner: authorizerSigner, rpcUrl: this.rpcUrl });
      })().catch((error) => { this.ready = undefined; throw error; });
    }
    return this.ready;
  }

  async fundSandboxWallet(walletAddress: string, requiredAtomic: bigint): Promise<string> {
    await this.initialize();
    if (requiredAtomic <= 0n || requiredAtomic > CANALIS_LIVE_SANDBOX_MAX_TASK_ATOMIC) throw new Error(`Live devnet sandbox funding must be between 1 and ${CANALIS_LIVE_SANDBOX_MAX_TASK_ATOMIC} atomic units.`);
    const mint = new PublicKey(CANALIS_DEVNET_SANDBOX_MINT);
    const owner = new PublicKey(walletAddress);
    const account = await getOrCreateAssociatedTokenAccount(this.connection, this.sponsor, mint, owner, false, "confirmed", undefined, TOKEN_PROGRAM_ID);
    const current = (await getAccount(this.connection, account.address, "confirmed", TOKEN_PROGRAM_ID)).amount;
    if (current < requiredAtomic) {
      await mintTo(this.connection, this.sponsor, mint, account.address, this.sponsor, requiredAtomic - current, [], { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
    }
    return account.address.toBase58();
  }

  async prepareChannel(input: { taskId: string; payer: string; providerId: string; ceilingAtomic: bigint; taskExpiresAtUnixSeconds: bigint; }): Promise<LiveChannelPreparation> {
    await this.initialize();
    const providerId = input.providerId as LiveProviderId;
    const providerPayTo = liveProviderAddress(providerId);
    const mint = new PublicKey(CANALIS_DEVNET_SANDBOX_MINT);
    await getOrCreateAssociatedTokenAccount(this.connection, this.sponsor, mint, new PublicKey(providerPayTo), false, "confirmed", undefined, TOKEN_PROGRAM_ID);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const remaining = input.taskExpiresAtUnixSeconds > now ? input.taskExpiresAtUnixSeconds - now : 0n;
    const maxTimeoutSeconds = Number(remaining > 3_600n ? 3_600n : remaining < 60n ? 60n : remaining);
    const receiver = this.authorizer.publicKey.toBase58();
    const facilitator = this.sponsor.publicKey.toBase58();
    const requirements: PaymentRequirements = {
      scheme: "upto", network: NETWORK, asset: CANALIS_DEVNET_SANDBOX_MINT, amount: input.ceilingAtomic.toString(), payTo: providerPayTo, maxTimeoutSeconds,
      extra: { feePayer: facilitator, receiverAuthorizer: receiver, withdrawDelay: Math.max(300, maxTimeoutSeconds), tokenProgram: TOKEN_PROGRAM_ID.toBase58(), memo: `canalis:${input.taskId}:${providerId}` },
    };
    return { providerId, paymentRequired: { x402Version: 2, resource: { url: `canalis://tasks/${input.taskId}/providers/${providerId}`, description: `Canalis live devnet channel for ${providerId}`, mimeType: "application/json", serviceName: "Canalis", tags: ["solana", "payment-channel", "devnet"] }, accepts: [requirements] }, providerPayTo, facilitator, receiverAuthorizer: receiver, mint: CANALIS_DEVNET_SANDBOX_MINT, network: NETWORK };
  }

  private async settleWithSafeRetry(payload: PaymentPayload, requirements: PaymentRequirements) {
    let result = await this.facilitator.settle(payload, requirements);
    for (let retry = 1; retry <= 3 && isTransientRpcRateLimit(result); retry += 1) {
      await sleep(retry * 1_500);
      result = await this.facilitator.settle(payload, requirements);
    }
    return result;
  }

  async deposit(paymentPayload: PaymentPayload, requirements: PaymentRequirements, expectedPayer: string): Promise<LiveDepositResult> {
    await this.initialize();
    validateLivePaymentPayload(paymentPayload, requirements, expectedPayer);
    const channelId = payloadField(paymentPayload, "channelId");
    const expiresAt = payloadField(paymentPayload, "expiresAt");
    const result = await this.settleWithSafeRetry({ ...paymentPayload, payload: { ...paymentPayload.payload, type: "deposit" } }, requirements);
    return { channelId, transactionSignature: settlementTransaction(result), expiresAtUnixSeconds: expiresAt, paymentPayload };
  }

  async claim(paymentPayload: PaymentPayload, requirements: PaymentRequirements, settledAtomic: bigint): Promise<LiveClaimResult> {
    await this.initialize();
    const ceilingAtomic = BigInt(requirements.amount);
    const accounting = assertLiveSettlementAccounting(ceilingAtomic, settledAtomic);
    const claimRequirements: PaymentRequirements = { ...requirements, amount: settledAtomic.toString() };
    const enrichment = await this.serverScheme.enrichSettlementPayload({ paymentPayload, requirements: claimRequirements, declaredExtensions: {}, phase: "after-handler" });
    const claimPayload: PaymentPayload = { ...paymentPayload, payload: { ...paymentPayload.payload, ...(enrichment ?? { type: "claim" }) } };
    const result = await this.settleWithSafeRetry(claimPayload, claimRequirements);
    return { channelId: payloadField(paymentPayload, "channelId"), transactionSignature: settlementTransaction(result), settledAtomic: accounting.settledAtomic.toString(), refundedAtomic: accounting.refundedAtomic.toString() };
  }
}
