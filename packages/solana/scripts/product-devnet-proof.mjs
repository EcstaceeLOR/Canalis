import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { x402Client } from "@x402/core/client";
import { UptoSvmScheme } from "@x402/svm/upto/client";
import {
  CANALIS_DEVNET_SANDBOX_MINT,
  DevnetX402ChannelGateway,
  SOLANA_DEVNET_CAIP2,
  assertLiveSettlementAccounting,
  liveProviderAddress,
} from "../dist/index.js";

const RPC_URL = process.env.SVM_RPC_URL?.trim() || "https://api.devnet.solana.com";
const PAYER_SEED_LABEL = "canalis-issue-28-product-proof-payer-v1";
const PROVIDER_ID = "search";
const CEILING_ATOMIC = 100_000n;
const AUTHORIZED_ATOMIC = 30_000n;

function seededKeypair(label) {
  return Keypair.fromSeed(createHash("sha256").update(label).digest());
}

function explorer(kind, value) {
  return `https://explorer.solana.com/${kind}/${value}?cluster=devnet`;
}

async function tokenBalance(connection, address) {
  return (await getAccount(connection, address, "confirmed", TOKEN_PROGRAM_ID)).amount;
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const gateway = new DevnetX402ChannelGateway(RPC_URL);
  const payer = seededKeypair(PAYER_SEED_LABEL);
  const payerAddress = payer.publicKey.toBase58();
  const providerAddress = liveProviderAddress(PROVIDER_ID);
  const mint = new PublicKey(CANALIS_DEVNET_SANDBOX_MINT);

  const payerTokenAccount = new PublicKey(
    await gateway.fundSandboxWallet(payerAddress, CEILING_ATOMIC),
  );

  const taskId = `task_issue_28_live_proof_${Date.now()}`;
  const preparation = await gateway.prepareChannel({
    taskId,
    payer: payerAddress,
    providerId: PROVIDER_ID,
    ceilingAtomic: CEILING_ATOMIC,
    taskExpiresAtUnixSeconds: BigInt(Math.floor(Date.now() / 1000) + 900),
  });
  const accepted = preparation.paymentRequired.accepts[0];
  if (!accepted) throw new Error("Prepared live channel has no accepted payment requirement.");

  const providerTokenAccount = await getAssociatedTokenAddress(
    mint,
    new PublicKey(providerAddress),
    false,
    TOKEN_PROGRAM_ID,
  );
  const payerBefore = await tokenBalance(connection, payerTokenAccount);
  const providerBefore = await tokenBalance(connection, providerTokenAccount);

  const payerSigner = await createKeyPairSignerFromBytes(payer.secretKey);
  const client = new x402Client();
  client.setSpendControls({
    allowedAssets: [
      {
        network: accepted.network,
        asset: accepted.asset,
        maxAmountPerPayment: accepted.amount,
      },
    ],
  });
  client.register(
    "solana:*",
    new UptoSvmScheme(payerSigner, { rpcUrl: RPC_URL }),
  );

  const paymentPayload = await client.createPaymentPayload(preparation.paymentRequired);
  const opened = await gateway.deposit(paymentPayload, accepted, payerAddress);
  const payerAfterOpen = await tokenBalance(connection, payerTokenAccount);

  const finalized = await gateway.claim(
    paymentPayload,
    accepted,
    AUTHORIZED_ATOMIC,
  );

  const payerAfter = await tokenBalance(connection, payerTokenAccount);
  const providerAfter = await tokenBalance(connection, providerTokenAccount);
  const providerReceived = providerAfter - providerBefore;
  const payerSpent = payerBefore - payerAfter;
  const accounting = assertLiveSettlementAccounting(
    CEILING_ATOMIC,
    AUTHORIZED_ATOMIC,
  );

  if (payerBefore - payerAfterOpen !== CEILING_ATOMIC) {
    throw new Error(
      `Open transaction did not escrow the fixed ceiling: expected ${CEILING_ATOMIC}, got ${payerBefore - payerAfterOpen}`,
    );
  }
  if (providerReceived !== AUTHORIZED_ATOMIC) {
    throw new Error(
      `Provider payout mismatch: expected ${AUTHORIZED_ATOMIC}, got ${providerReceived}`,
    );
  }
  if (payerSpent !== AUTHORIZED_ATOMIC) {
    throw new Error(
      `Payer net spend mismatch: expected ${AUTHORIZED_ATOMIC}, got ${payerSpent}`,
    );
  }
  if (BigInt(finalized.refundedAtomic) !== accounting.refundedAtomic) {
    throw new Error(
      `Refund mismatch: expected ${accounting.refundedAtomic}, got ${finalized.refundedAtomic}`,
    );
  }

  const proof = {
    proof: "canalis-live-product-channel-lifecycle",
    taskId,
    network: SOLANA_DEVNET_CAIP2,
    rpcUrl: RPC_URL,
    mint: CANALIS_DEVNET_SANDBOX_MINT,
    payer: payerAddress,
    provider: providerAddress,
    providerId: PROVIDER_ID,
    channelId: opened.channelId,
    openTransaction: opened.transactionSignature,
    finalizationTransaction: finalized.transactionSignature,
    explorer: {
      channel: explorer("address", opened.channelId),
      openTransaction: explorer("tx", opened.transactionSignature),
      finalizationTransaction: explorer("tx", finalized.transactionSignature),
    },
    balances: {
      payerBefore: payerBefore.toString(),
      payerAfterOpen: payerAfterOpen.toString(),
      payerAfter: payerAfter.toString(),
      providerBefore: providerBefore.toString(),
      providerAfter: providerAfter.toString(),
      providerReceived: providerReceived.toString(),
      payerSpent: payerSpent.toString(),
      channelCeiling: CEILING_ATOMIC.toString(),
      cumulativeAuthorized: AUTHORIZED_ATOMIC.toString(),
      unusedReturned: accounting.refundedAtomic.toString(),
    },
  };

  await writeFile(
    new URL("../product-devnet-proof.json", import.meta.url),
    `${JSON.stringify(proof, null, 2)}\n`,
  );
  console.log(JSON.stringify(proof, null, 2));
}

await main();
