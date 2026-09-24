import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import {
  paymentMiddleware,
  setSettlementOverrides,
  x402ResourceServer,
} from "@x402/express";
import { UptoSvmScheme } from "@x402/svm/upto/server";
import { config } from "dotenv";
import express from "express";

config();

const SOLANA_DEVNET =
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as Network;
const MAX_PRICE = "$0.10";
const ACTUAL_PRICE = "$0.03";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const payeeAddress = requiredEnv("SVM_PAYEE_ADDRESS");
const receiverAuthorizerPrivateKey = requiredEnv(
  "SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY",
);
const facilitatorUrl = requiredEnv("FACILITATOR_URL");
const rpcUrl = process.env.SVM_RPC_URL ?? "https://api.devnet.solana.com";

const receiverAuthorizerSigner = await createKeyPairSignerFromBytes(
  base58.decode(receiverAuthorizerPrivateKey),
);

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  SOLANA_DEVNET,
  new UptoSvmScheme({
    receiverAuthorizerSigner,
    rpcUrl,
  }),
);

const app = express();

app.get("/health", (_req, res) => {
  res.json({ ok: true, network: SOLANA_DEVNET });
});

app.use(
  paymentMiddleware(
    {
      "GET /api/tool": {
        accepts: {
          scheme: "upto",
          price: MAX_PRICE,
          network: SOLANA_DEVNET,
          payTo: payeeAddress,
        },
        description: "Canalis deterministic paid tool — payment-channel spike",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/api/tool", (_req, res) => {
  // The client authorizes up to $0.10, but this demo always consumes $0.03.
  // The x402 SVM upto facilitator settles the actual amount and returns the
  // unused channel deposit to the payer during terminal distribution.
  setSettlementOverrides(res, { amount: ACTUAL_PRICE });

  res.json({
    result: "Canalis paid tool completed",
    billing: {
      authorizedMaximum: MAX_PRICE,
      actualCharge: ACTUAL_PRICE,
      expectedUnusedBudget: "$0.07",
    },
  });
});

const port = Number(process.env.PORT ?? 4021);
app.listen(port, () => {
  console.log(`Canalis channel spike listening on http://localhost:${port}`);
  console.log(`Network: ${SOLANA_DEVNET}`);
  console.log(`Payee: ${payeeAddress}`);
  console.log(`Receiver authorizer: ${receiverAuthorizerSigner.address}`);
  console.log(`GET /api/tool authorizes ${MAX_PRICE} and settles ${ACTUAL_PRICE}`);
});
