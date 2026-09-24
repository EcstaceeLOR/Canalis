import { describe, expect, it } from "vitest";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import {
  executeProviderRequest,
  MppProviderAdapter,
  MppProviderError,
  X402ProviderAdapter,
  X402ProviderError,
  type PaymentAuthorizer,
  type ProviderQuote,
} from "../src/index.js";

function base64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function matchingAuthorizer(reference = "canalis:test"): PaymentAuthorizer {
  return {
    authorize: async (quote: ProviderQuote) => ({
      authorizationId: `auth:${quote.requestId}`,
      providerId: quote.providerId,
      requestId: quote.requestId,
      mint: quote.mint,
      amountAtomic: quote.priceAtomic,
      protocol: quote.protocol,
      paymentReference: reference,
    }),
  };
}

describe("X402ProviderAdapter", () => {
  it("maps an x402 upto challenge and settlement into a Canalis receipt", async () => {
    const paymentRequired = {
      x402Version: 2,
      resource: {
        url: "https://provider.test/tool",
        description: "paid tool",
        mimeType: "application/json",
      },
      accepts: [
        {
          scheme: "upto",
          network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
          asset: "USDC_DEVNET_MINT",
          amount: "100000",
          payTo: "provider-wallet",
          maxTimeoutSeconds: 300,
          extra: {},
        },
      ],
    };

    const settlement = {
      success: true,
      transaction: "solana-settlement-signature",
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      payer: "payer-wallet",
      amount: "30000",
    };

    let paidCalls = 0;
    const adapter = new X402ProviderAdapter<{ query: string }, { answer: string }>({
      metadata: {
        id: "x402-search",
        name: "x402 Search",
        payee: "provider-wallet",
        description: "Protocol-backed paid search",
      },
      httpClient: new x402HTTPClient(new x402Client()),
      unpaidFetch: async () =>
        new Response("", {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": base64Json(paymentRequired),
          },
        }),
      paidFetch: async () => {
        paidCalls += 1;
        return new Response(JSON.stringify({ answer: "paid result" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": base64Json(settlement),
          },
        });
      },
      buildRequest: () => ({ url: "https://provider.test/tool" }),
    });

    const result = await executeProviderRequest(
      adapter,
      { requestId: "req-x402", input: { query: "solana" } },
      matchingAuthorizer("canalis:x402"),
      { nowUnixSeconds: () => 123n },
    );

    expect(paidCalls).toBe(1);
    expect(result.output).toEqual({ answer: "paid result" });
    expect(result.receipt.protocol).toBe("x402");
    expect(result.receipt.priceAtomic).toBe(100000n);
    expect(result.receipt.protocolMetadata).toMatchObject({
      "x402.scheme": "upto",
      "x402.network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      "x402.transaction": "solana-settlement-signature",
      "x402.amount": "30000",
      "canalis.paymentReference": "canalis:x402",
    });
  });

  it("does not attempt the paid fetch when Canalis authorization is denied", async () => {
    let paidCalls = 0;
    const adapter = new X402ProviderAdapter<unknown, unknown>({
      metadata: {
        id: "x402-denied",
        name: "Denied x402",
        payee: "provider-wallet",
        description: "denied payment test",
      },
      httpClient: new x402HTTPClient(new x402Client()),
      unpaidFetch: async () =>
        new Response("", {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": base64Json({
              x402Version: 2,
              resource: { url: "https://provider.test/tool" },
              accepts: [
                {
                  scheme: "upto",
                  network: "solana:devnet",
                  asset: "MINT",
                  amount: "100",
                  payTo: "provider-wallet",
                  maxTimeoutSeconds: 60,
                  extra: {},
                },
              ],
            }),
          },
        }),
      paidFetch: async () => {
        paidCalls += 1;
        return new Response("should not happen", { status: 200 });
      },
      buildRequest: () => ({ url: "https://provider.test/tool" }),
    });

    await expect(
      executeProviderRequest(
        adapter,
        { requestId: "denied", input: null },
        {
          authorize: async () => {
            throw new Error("POLICY_DENIED");
          },
        },
      ),
    ).rejects.toThrow("POLICY_DENIED");
    expect(paidCalls).toBe(0);
  });

  it("rejects a settlement above the Canalis authorization", async () => {
    const adapter = new X402ProviderAdapter<unknown, unknown>({
      metadata: {
        id: "x402-over",
        name: "Over-settlement",
        payee: "provider-wallet",
        description: "over settlement test",
      },
      httpClient: new x402HTTPClient(new x402Client()),
      unpaidFetch: async () =>
        new Response("", {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": base64Json({
              x402Version: 2,
              resource: { url: "https://provider.test/tool" },
              accepts: [
                {
                  scheme: "upto",
                  network: "solana:devnet",
                  asset: "MINT",
                  amount: "100",
                  payTo: "provider-wallet",
                  maxTimeoutSeconds: 60,
                  extra: {},
                },
              ],
            }),
          },
        }),
      paidFetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": base64Json({
              success: true,
              transaction: "tx",
              network: "solana:devnet",
              payer: "payer",
              amount: "101",
            }),
          },
        }),
      buildRequest: () => ({ url: "https://provider.test/tool" }),
    });

    await expect(
      executeProviderRequest(
        adapter,
        { requestId: "over", input: null },
        matchingAuthorizer(),
      ),
    ).rejects.toMatchObject<X402ProviderError>({
      code: "X402_SETTLEMENT_EXCEEDS_AUTHORIZATION",
    });
  });
});

describe("MppProviderAdapter", () => {
  it("maps a metered MPP session challenge and receipt into Canalis metadata", async () => {
    const requestPayload = {
      amount: "2",
      currency: "0xTIP20",
      recipient: "0xProvider",
      unitType: "llm_token",
      suggestedDeposit: "1000",
    };
    const challenge = [
      'Payment id="challenge-1"',
      'realm="provider"',
      'method="tempo"',
      'intent="session"',
      `request="${base64UrlJson(requestPayload)}"`,
      'expires="2026-09-24T18:00:00Z"',
    ].join(", ");
    const receipt = {
      challengeId: "challenge-2",
      method: "tempo",
      status: "success",
      reference: "tempo-session-reference",
      timestamp: "2026-09-24T16:00:00Z",
      network: "eip155:4217",
    };

    const adapter = new MppProviderAdapter<{ maxUnits: bigint }, { text: string }>({
      metadata: {
        id: "mpp-inference",
        name: "MPP Inference",
        payee: "0xProvider",
        description: "metered MPP inference",
      },
      unpaidFetch: async () =>
        new Response("", {
          status: 402,
          headers: { "WWW-Authenticate": challenge },
        }),
      paidFetch: async () =>
        new Response(JSON.stringify({ text: "model output" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "Payment-Receipt": base64UrlJson(receipt),
          },
        }),
      buildRequest: () => ({ url: "https://mpp.test/inference" }),
      sessionUnits: (request) => request.input.maxUnits,
    });

    const result = await executeProviderRequest(
      adapter,
      { requestId: "req-mpp", input: { maxUnits: 50n } },
      matchingAuthorizer("canalis:mpp"),
      { nowUnixSeconds: () => 456n },
    );

    expect(result.receipt.priceAtomic).toBe(100n);
    expect(result.receipt.protocol).toBe("mpp");
    expect(result.receipt.protocolMetadata).toMatchObject({
      "mpp.intent": "session",
      "mpp.unitPriceAtomic": "2",
      "mpp.unitsAuthorized": "50",
      "mpp.reference": "tempo-session-reference",
      "mpp.network": "eip155:4217",
      "canalis.paymentReference": "canalis:mpp",
    });
  });

  it("surfaces unsupported MPP methods cleanly", async () => {
    const challenge = [
      'Payment id="challenge-unsupported"',
      'realm="provider"',
      'method="card"',
      'intent="charge"',
      `request="${base64UrlJson({ amount: "5", currency: "usd" })}"`,
    ].join(", ");

    const adapter = new MppProviderAdapter<unknown, unknown>({
      metadata: {
        id: "mpp-card",
        name: "MPP Card",
        payee: "merchant",
        description: "unsupported method test",
      },
      unpaidFetch: async () =>
        new Response("", {
          status: 402,
          headers: { "WWW-Authenticate": challenge },
        }),
      paidFetch: async () => new Response("", { status: 200 }),
      buildRequest: () => ({ url: "https://mpp.test/paid" }),
    });

    await expect(
      adapter.quote({ requestId: "unsupported", input: null }),
    ).rejects.toMatchObject<MppProviderError>({
      code: "MPP_UNSUPPORTED_PAYMENT",
    });
  });
});
