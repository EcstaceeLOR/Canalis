import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { Server } from "node:http";

import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { x402Facilitator } from "@x402/core/facilitator";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  paymentMiddleware,
  setSettlementOverrides,
  x402ResourceServer,
} from "@x402/express";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { UptoSvmScheme as UptoSvmClientScheme } from "@x402/svm/upto/client";
import { UptoSvmScheme as UptoSvmFacilitatorScheme } from "@x402/svm/upto/facilitator";
import { UptoSvmScheme as UptoSvmServerScheme } from "@x402/svm/upto/server";
import express from "express";

const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as Network;
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const RPC_URL = process.env.SVM_RPC_URL ?? "https://api.devnet.solana.com";
const PUBLIC_DEVNET_PAYER_SEED_LABEL = "canalis-cwf-2026-issue-1-devnet-payer";

const INITIAL_PAYER_TOKENS = 200_000n;
const MAX_AMOUNT = 100_000n;
const ACTUAL_AMOUNT = 30_000n;
const UNUSED_AMOUNT = MAX_AMOUNT - ACTUAL_AMOUNT;
const FACILITATOR_LAMPORTS = 20_000_000;
const MIN_PAYER_LAMPORTS = 80_000_000;
const FACILITATOR_PORT = 4022;
const RESOURCE_PORT = 4021;

type SettleEvidence = {
  type: string;
  channelId: string;
  transaction: string;
  success: boolean;
};

type ProofArtifact = {
  network: string;
  rpcUrl: string;
  mint: string;
  payer: string;
  provider: string;
  facilitator: string;
  receiverAuthorizer: string;
  channelId: string;
  openTransaction: string;
  claimTransaction: string;
  facilitatorFundingTransaction: string;
  explorer: {
    channel: string;
    openTransaction: string;
    claimTransaction: string;
  };
  balances: {
    payerBefore: string;
    payerAfter: string;
    providerBefore: string;
    providerAfter: string;
    providerReceived: string;
    payerSpent: string;
    authorizedMaximum: string;
    actualSettled: string;
    unusedReturned: string;
  };
};

function createPublicDevnetPayer(): Keypair {
  const seed = createHash("sha256").update(PUBLIC_DEVNET_PAYER_SEED_LABEL).digest();
  return Keypair.fromSeed(seed);
}

async function assertDevnet(connection: Connection): Promise<void> {
  const genesisHash = await connection.getGenesisHash();
  if (genesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error(
      `Refusing to run public proof payer outside Solana devnet. Expected ${DEVNET_GENESIS_HASH}, got ${genesisHash}`,
    );
  }
}

function listen(app: ReturnType<typeof express>, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

function getSchemePayload(paymentPayload: PaymentPayload): Record<string, unknown> {
  return paymentPayload.payload as Record<string, unknown>;
}

async function main(): Promise<void> {
  const connection = new Connection(RPC_URL, "confirmed");
  await assertDevnet(connection);

  const payer = createPublicDevnetPayer();
  const provider = Keypair.generate();
  const facilitatorKeypair = Keypair.generate();
  const receiverAuthorizer = Keypair.generate();

  const payerSol = await connection.getBalance(payer.publicKey, "confirmed");
  if (payerSol < MIN_PAYER_LAMPORTS) {
    throw new Error(
      `Public devnet payer ${payer.publicKey.toBase58()} has only ${payerSol} lamports; fund it with devnet SOL before running the proof`,
    );
  }

  console.log(`[devnet-proof] payer=${payer.publicKey.toBase58()} (${payerSol} lamports)`);
  console.log(`[devnet-proof] provider=${provider.publicKey.toBase58()}`);
  console.log(`[devnet-proof] facilitator=${facilitatorKeypair.publicKey.toBase58()}`);

  const facilitatorFundingTransaction = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: facilitatorKeypair.publicKey,
        lamports: FACILITATOR_LAMPORTS,
      }),
    ),
    [payer],
    { commitment: "confirmed" },
  );

  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    6,
    undefined,
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
  );

  const payerTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey,
    false,
    "confirmed",
  );
  const providerTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    provider.publicKey,
    false,
    "confirmed",
  );

  await mintTo(
    connection,
    payer,
    mint,
    payerTokenAccount.address,
    payer,
    INITIAL_PAYER_TOKENS,
    [],
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
  );

  const payerBefore = (
    await getAccount(connection, payerTokenAccount.address, "confirmed", TOKEN_PROGRAM_ID)
  ).amount;
  const providerBefore = (
    await getAccount(connection, providerTokenAccount.address, "confirmed", TOKEN_PROGRAM_ID)
  ).amount;

  const payerSigner = await createKeyPairSignerFromBytes(payer.secretKey);
  const facilitatorSigner = await createKeyPairSignerFromBytes(facilitatorKeypair.secretKey);
  const authorizerSigner = await createKeyPairSignerFromBytes(receiverAuthorizer.secretKey);

  const settleEvidence: SettleEvidence[] = [];
  const facilitator = new x402Facilitator()
    .onVerifyFailure(async context => {
      console.error(`[devnet-proof] facilitator verify failure: ${context.error.message}`);
    })
    .onSettleFailure(async context => {
      console.error(`[devnet-proof] facilitator settle failure: ${context.error.message}`);
    });
  facilitator.register(
    NETWORK,
    new UptoSvmFacilitatorScheme(
      toFacilitatorSvmSigner(facilitatorSigner, { defaultRpcUrl: RPC_URL }),
      { maxChannelLifetimeSecs: 3_600 },
    ),
  );

  const facilitatorApp = express();
  facilitatorApp.use(express.json());
  facilitatorApp.post("/verify", async (req, res) => {
    const result: VerifyResponse = await facilitator.verify(
      req.body.paymentPayload as PaymentPayload,
      req.body.paymentRequirements as PaymentRequirements,
    );
    console.log(`[devnet-proof] verify=${JSON.stringify(result)}`);
    res.json(result);
  });
  facilitatorApp.post("/settle", async (req, res) => {
    const paymentPayload = req.body.paymentPayload as PaymentPayload;
    const result: SettleResponse = await facilitator.settle(
      paymentPayload,
      req.body.paymentRequirements as PaymentRequirements,
    );
    console.log(`[devnet-proof] settle=${JSON.stringify(result)}`);
    const payload = getSchemePayload(paymentPayload);
    settleEvidence.push({
      type: typeof payload.type === "string" ? payload.type : "unknown",
      channelId: typeof payload.channelId === "string" ? payload.channelId : "",
      transaction:
        typeof (result as { transaction?: unknown }).transaction === "string"
          ? (result as { transaction: string }).transaction
          : "",
      success: result.success,
    });
    res.json(result);
  });
  facilitatorApp.get("/supported", (_req, res) => {
    const supported = facilitator.getSupported();
    console.log(`[devnet-proof] supported=${JSON.stringify(supported)}`);
    res.json(supported);
  });

  const facilitatorServer = await listen(facilitatorApp, FACILITATOR_PORT);

  const resourceApp = express();
  const facilitatorClient = new HTTPFacilitatorClient({
    url: `http://127.0.0.1:${FACILITATOR_PORT}`,
  });
  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    NETWORK,
    new UptoSvmServerScheme({
      receiverAuthorizerSigner: authorizerSigner,
      rpcUrl: RPC_URL,
    }),
  );

  resourceApp.use(
    paymentMiddleware(
      {
        "GET /api/tool": {
          accepts: {
            scheme: "upto",
            price: {
              amount: MAX_AMOUNT.toString(),
              asset: mint.toBase58(),
              extra: { tokenProgram: TOKEN_PROGRAM_ID.toBase58() },
            },
            network: NETWORK,
            payTo: provider.publicKey.toBase58(),
          },
          description: "Canalis devnet payment-channel proof",
          mimeType: "application/json",
        },
      },
      resourceServer,
    ),
  );
  resourceApp.get("/api/tool", (_req, res) => {
    setSettlementOverrides(res, { amount: ACTUAL_AMOUNT.toString() });
    res.json({
      ok: true,
      authorizedMaximum: MAX_AMOUNT.toString(),
      actualCharge: ACTUAL_AMOUNT.toString(),
    });
  });

  const resourceHttpServer = await listen(resourceApp, RESOURCE_PORT);

  try {
    const client = new x402Client();
    client.setSpendControls({
      allowedAssets: [
        {
          network: NETWORK,
          asset: mint.toBase58(),
          maxAmountPerPayment: MAX_AMOUNT.toString(),
        },
      ],
    });
    client.register("solana:*", new UptoSvmClientScheme(payerSigner));

    const paidFetch = wrapFetchWithPayment(fetch, client);
    const httpClient = new x402HTTPClient(client);
    const response = await paidFetch(`http://127.0.0.1:${RESOURCE_PORT}/api/tool`);
    const processedResponse = await httpClient.processResponse(response.clone());
    const resourceBody = await response.json();

    if (!response.ok) {
      console.error(`[devnet-proof] paymentResult=${JSON.stringify(processedResponse)}`);
      console.error(`[devnet-proof] settleEvidence=${JSON.stringify(settleEvidence)}`);
      throw new Error(`Paid request failed: HTTP ${response.status} ${JSON.stringify(resourceBody)}`);
    }

    const payerAfter = (
      await getAccount(connection, payerTokenAccount.address, "confirmed", TOKEN_PROGRAM_ID)
    ).amount;
    const providerAfter = (
      await getAccount(connection, providerTokenAccount.address, "confirmed", TOKEN_PROGRAM_ID)
    ).amount;

    const providerReceived = providerAfter - providerBefore;
    const payerSpent = payerBefore - payerAfter;

    if (providerReceived !== ACTUAL_AMOUNT) {
      throw new Error(`Provider delta mismatch: expected ${ACTUAL_AMOUNT}, got ${providerReceived}`);
    }
    if (payerSpent !== ACTUAL_AMOUNT) {
      throw new Error(`Payer delta mismatch: expected ${ACTUAL_AMOUNT}, got ${payerSpent}`);
    }
    if (payerAfter !== INITIAL_PAYER_TOKENS - ACTUAL_AMOUNT) {
      throw new Error(
        `Unused channel value was not recovered: expected ${INITIAL_PAYER_TOKENS - ACTUAL_AMOUNT}, got ${payerAfter}`,
      );
    }

    const deposit = settleEvidence.find(event => event.type === "deposit");
    const claim = settleEvidence.find(event => event.type === "claim");
    if (!deposit?.success || !deposit.channelId || !deposit.transaction) {
      throw new Error(`Missing successful deposit/open evidence: ${JSON.stringify(settleEvidence)}`);
    }
    if (!claim?.success || !claim.transaction || claim.channelId !== deposit.channelId) {
      throw new Error(`Missing successful claim evidence: ${JSON.stringify(settleEvidence)}`);
    }

    const explorerBase = "https://explorer.solana.com";
    const artifact: ProofArtifact = {
      network: NETWORK,
      rpcUrl: RPC_URL,
      mint: mint.toBase58(),
      payer: payer.publicKey.toBase58(),
      provider: provider.publicKey.toBase58(),
      facilitator: facilitatorKeypair.publicKey.toBase58(),
      receiverAuthorizer: receiverAuthorizer.publicKey.toBase58(),
      channelId: deposit.channelId,
      openTransaction: deposit.transaction,
      claimTransaction: claim.transaction,
      facilitatorFundingTransaction,
      explorer: {
        channel: `${explorerBase}/address/${deposit.channelId}?cluster=devnet`,
        openTransaction: `${explorerBase}/tx/${deposit.transaction}?cluster=devnet`,
        claimTransaction: `${explorerBase}/tx/${claim.transaction}?cluster=devnet`,
      },
      balances: {
        payerBefore: payerBefore.toString(),
        payerAfter: payerAfter.toString(),
        providerBefore: providerBefore.toString(),
        providerAfter: providerAfter.toString(),
        providerReceived: providerReceived.toString(),
        payerSpent: payerSpent.toString(),
        authorizedMaximum: MAX_AMOUNT.toString(),
        actualSettled: ACTUAL_AMOUNT.toString(),
        unusedReturned: UNUSED_AMOUNT.toString(),
      },
    };

    await writeFile("devnet-proof.json", `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    console.log("[devnet-proof] PASS");
    console.log(`[devnet-proof] mint=${artifact.mint}`);
    console.log(`[devnet-proof] channel=${artifact.channelId}`);
    console.log(`[devnet-proof] openTx=${artifact.openTransaction}`);
    console.log(`[devnet-proof] claimTx=${artifact.claimTransaction}`);
    console.log(`[devnet-proof] max=${MAX_AMOUNT} actual=${ACTUAL_AMOUNT} unusedReturned=${UNUSED_AMOUNT}`);
    console.log(`[devnet-proof] payer=${payerBefore}->${payerAfter} provider=${providerBefore}->${providerAfter}`);
  } finally {
    await Promise.all([close(resourceHttpServer), close(facilitatorServer)]);
  }
}

await main();
