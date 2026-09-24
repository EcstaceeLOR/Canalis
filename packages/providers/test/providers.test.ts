import { describe, expect, it } from "vitest";
import {
  DemoDataProvider,
  DemoInferenceProvider,
  DemoSearchProvider,
  executeProviderRequest,
  hashProviderResponse,
  type PaymentAuthorizer,
  type ProviderAdapter,
  type ProviderQuote,
  type ProviderRequest,
} from "../src/index.js";

function approvingAuthorizer(
  paymentReference = "demo-payment-1",
): PaymentAuthorizer {
  return {
    async authorize(quote) {
      return {
        authorizationId: `auth:${quote.requestId}`,
        providerId: quote.providerId,
        requestId: quote.requestId,
        mint: quote.mint,
        amountAtomic: quote.priceAtomic,
        protocol: quote.protocol,
        paymentReference,
      };
    },
  };
}

describe("deterministic demo providers", () => {
  it("executes Search with a receipt after authorization", async () => {
    const provider = new DemoSearchProvider();
    const result = await executeProviderRequest(
      provider,
      { requestId: "req-search", input: { query: "Solana payment channels" } },
      approvingAuthorizer(),
      { nowUnixSeconds: () => 1234n },
    );

    expect(result.output.results).toHaveLength(3);
    expect(result.receipt.providerId).toBe("search");
    expect(result.receipt.priceAtomic).toBe(50_000n);
    expect(result.receipt.timestampUnixSeconds).toBe(1234n);
    expect(result.receipt.paymentReference).toBe("demo-payment-1");
    expect(result.receipt.responseHash).toBe(hashProviderResponse(result.output));
  });

  it("returns the same Search output for the same request input", async () => {
    const provider = new DemoSearchProvider();
    const request = { requestId: "req-search", input: { query: "Canalis" } };

    const first = await executeProviderRequest(
      provider,
      request,
      approvingAuthorizer("payment-a"),
    );
    const second = await executeProviderRequest(
      provider,
      request,
      approvingAuthorizer("payment-b"),
    );

    expect(first.output).toEqual(second.output);
    expect(first.receipt.responseHash).toBe(second.receipt.responseHash);
  });

  it("executes deterministic Data lookup", async () => {
    const result = await executeProviderRequest(
      new DemoDataProvider(),
      { requestId: "req-data", input: { key: "SOL-USDC" } },
      approvingAuthorizer(),
    );

    expect(result.receipt.providerId).toBe("data");
    expect(result.receipt.priceAtomic).toBe(30_000n);
    expect(result.output.source).toBe("canalis-demo-dataset");
    expect(result.output.value).toBeTypeOf("number");
  });

  it("executes deterministic Inference fulfillment", async () => {
    const result = await executeProviderRequest(
      new DemoInferenceProvider(),
      { requestId: "req-ai", input: { prompt: "Summarize the evidence" } },
      approvingAuthorizer(),
    );

    expect(result.receipt.providerId).toBe("inference");
    expect(result.receipt.priceAtomic).toBe(120_000n);
    expect(result.output.completion).toContain("Summarize the evidence");
    expect(result.output.model).toBe("canalis-demo-1");
  });

  it("does not fulfill paid work when authorization is denied", async () => {
    let fulfillCalls = 0;

    const provider: ProviderAdapter<{ value: string }, { ok: true }> = {
      metadata: {
        id: "guarded",
        name: "Guarded",
        payee: "demo:guarded",
        protocol: "demo",
        description: "Authorization order test",
      },
      async quote(request) {
        return {
          providerId: "guarded",
          requestId: request.requestId,
          mint: "USDC",
          priceAtomic: 1n,
          protocol: "demo",
        };
      },
      async fulfillAuthorized() {
        fulfillCalls += 1;
        return { ok: true };
      },
    };

    const denyingAuthorizer: PaymentAuthorizer = {
      async authorize() {
        throw new Error("policy denied");
      },
    };

    await expect(
      executeProviderRequest(
        provider,
        { requestId: "denied", input: { value: "secret work" } },
        denyingAuthorizer,
      ),
    ).rejects.toThrow("policy denied");
    expect(fulfillCalls).toBe(0);
  });

  it("rejects an authorization for a different amount before fulfillment", async () => {
    let fulfillCalls = 0;
    const provider: ProviderAdapter<string, string> = {
      metadata: {
        id: "amount-check",
        name: "Amount Check",
        payee: "demo:amount-check",
        protocol: "demo",
        description: "Authorization binding test",
      },
      async quote(request: ProviderRequest<string>): Promise<ProviderQuote> {
        return {
          providerId: "amount-check",
          requestId: request.requestId,
          mint: "USDC",
          priceAtomic: 10n,
          protocol: "demo",
        };
      },
      async fulfillAuthorized() {
        fulfillCalls += 1;
        return "should not run";
      },
    };

    const wrongAmount: PaymentAuthorizer = {
      async authorize(quote) {
        return {
          authorizationId: "bad-auth",
          providerId: quote.providerId,
          requestId: quote.requestId,
          mint: quote.mint,
          amountAtomic: quote.priceAtomic + 1n,
          protocol: quote.protocol,
        };
      },
    };

    await expect(
      executeProviderRequest(
        provider,
        { requestId: "req-wrong-amount", input: "payload" },
        wrongAmount,
      ),
    ).rejects.toThrow(/amount mismatch/);
    expect(fulfillCalls).toBe(0);
  });

  it("binds receipts to request id, authorization id and response hash", async () => {
    const result = await executeProviderRequest(
      new DemoDataProvider(),
      { requestId: "receipt-test", input: { key: "volume" } },
      approvingAuthorizer("channel:voucher:150000"),
      { nowUnixSeconds: () => 9_999n },
    );

    expect(result.receipt).toMatchObject({
      providerId: "data",
      requestId: "receipt-test",
      authorizationId: "auth:receipt-test",
      paymentReference: "channel:voucher:150000",
      protocol: "demo",
      timestampUnixSeconds: 9_999n,
    });
    expect(result.receipt.responseHash).toHaveLength(64);
  });

  it("rejects empty provider inputs before quoting paid work", async () => {
    await expect(
      new DemoSearchProvider().quote({ requestId: "empty", input: { query: " " } }),
    ).rejects.toThrow(/must not be empty/);
    await expect(
      new DemoDataProvider().quote({ requestId: "empty", input: { key: "" } }),
    ).rejects.toThrow(/must not be empty/);
    await expect(
      new DemoInferenceProvider().quote({
        requestId: "empty",
        input: { prompt: "" },
      }),
    ).rejects.toThrow(/must not be empty/);
  });
});
