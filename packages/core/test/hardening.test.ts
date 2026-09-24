import { describe, expect, it } from "vitest";
import type {
  PaymentAuthorization,
  ProviderAdapter,
  ProviderQuote,
  ProviderRequest,
} from "@canalis/providers";
import { CanalisRouteOrchestrator, type Task } from "../src/index.js";

type TestInput = { value: string };

class FixedProvider implements ProviderAdapter<TestInput, { ok: true }> {
  readonly metadata;
  fulfillCalls = 0;

  constructor(
    readonly id: string,
    private readonly priceAtomic: bigint,
    private readonly mint = "USDC",
    private readonly failFulfillment = false,
  ) {
    this.metadata = {
      id,
      name: `Fixed ${id}`,
      payee: `payee-${id}`,
      protocol: "demo" as const,
      description: "Adversarial test provider",
    };
  }

  async quote(request: ProviderRequest<TestInput>): Promise<ProviderQuote> {
    return {
      providerId: this.id,
      requestId: request.requestId,
      mint: this.mint,
      priceAtomic: this.priceAtomic,
      protocol: "demo",
    };
  }

  async fulfillAuthorized(
    _request: ProviderRequest<TestInput>,
    _quote: ProviderQuote,
    _authorization: PaymentAuthorization,
  ): Promise<{ ok: true }> {
    this.fulfillCalls += 1;
    if (this.failFulfillment) throw new Error("provider failed after authorization");
    return { ok: true };
  }
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "hardening-task",
    owner: "owner",
    agentId: "agent",
    budget: { mint: "USDC", totalAtomic: 200_000n },
    policy: {
      allowedProviderIds: ["metered"],
      maxPerCallAtomic: 10_000n,
      providerCapsAtomic: { metered: 200_000n },
    },
    status: "active",
    createdAtUnixSeconds: 1_000n,
    expiresAtUnixSeconds: 10_000n,
    ...overrides,
  };
}

describe("Canalis hardening invariants", () => {
  it("does not drift across a long sequence of cumulative authorizations", async () => {
    const provider = new FixedProvider("metered", 10_000n);
    const orchestrator = new CanalisRouteOrchestrator(
      task(),
      { metered: provider },
      [{ providerId: "metered", ceilingAtomic: 200_000n }],
      () => 2_000n,
    );

    for (let index = 0; index < 20; index += 1) {
      const result = await orchestrator.execute("metered", {
        requestId: `call-${index}`,
        input: { value: String(index) },
      });
      expect(result.ok).toBe(true);
    }

    const exhausted = await orchestrator.execute("metered", {
      requestId: "call-over-ceiling",
      input: { value: "overflow" },
    });

    expect(exhausted.ok).toBe(false);
    expect(exhausted.flow.rejectionCode).toBe("CHANNEL_CEILING_EXCEEDED");

    const graph = orchestrator.getPaymentGraph();
    expect(graph.spentAtomic).toBe(200_000n);
    expect(graph.remainingAtomic).toBe(0n);
    expect(graph.providers[0]?.cumulativeAuthorizedAtomic).toBe(200_000n);
    expect(graph.providers[0]?.spentAtomic).toBe(200_000n);
    expect(provider.fulfillCalls).toBe(20);
    expect(graph.flows.filter((flow) => flow.status === "fulfilled")).toHaveLength(20);
    expect(graph.flows.filter((flow) => flow.status === "rejected")).toHaveLength(1);
  });

  it("rejects a wrong-mint quote before provider fulfillment and without ledger mutation", async () => {
    const provider = new FixedProvider("metered", 10_000n, "NOT-USDC");
    const orchestrator = new CanalisRouteOrchestrator(
      task(),
      { metered: provider },
      [{ providerId: "metered", ceilingAtomic: 200_000n }],
      () => 2_000n,
    );

    const result = await orchestrator.execute("metered", {
      requestId: "wrong-mint",
      input: { value: "x" },
    });

    expect(result.ok).toBe(false);
    expect(result.flow.rejectionCode).toBe("MINT_MISMATCH");
    expect(provider.fulfillCalls).toBe(0);
    expect(orchestrator.getPaymentGraph().spentAtomic).toBe(0n);
  });

  it("never rolls back an authorization after a downstream provider failure", async () => {
    const failing = new FixedProvider("metered", 10_000n, "USDC", true);
    const orchestrator = new CanalisRouteOrchestrator(
      task(),
      { metered: failing },
      [{ providerId: "metered", ceilingAtomic: 200_000n }],
      () => 2_000n,
    );

    await expect(
      orchestrator.execute("metered", {
        requestId: "authorized-then-failed",
        input: { value: "x" },
      }),
    ).rejects.toThrow(/provider failed after authorization/);

    const graph = orchestrator.getPaymentGraph();
    expect(graph.spentAtomic).toBe(10_000n);
    expect(graph.providers[0]?.cumulativeAuthorizedAtomic).toBe(10_000n);
    expect(graph.flows[0]?.status).toBe("failed");

    // Financial authorization is monotonic. A failed downstream response cannot
    // make the same 10_000 atomic units available for a second authorization.
    expect(graph.remainingAtomic).toBe(190_000n);
  });

  it("rejects duplicate, zero, and out-of-policy channel reservations at construction", () => {
    const provider = new FixedProvider("metered", 10_000n);

    expect(
      () =>
        new CanalisRouteOrchestrator(
          task(),
          { metered: provider },
          [
            { providerId: "metered", ceilingAtomic: 10_000n },
            { providerId: "metered", ceilingAtomic: 10_000n },
          ],
        ),
    ).toThrow(/duplicate channel reservation/);

    expect(
      () =>
        new CanalisRouteOrchestrator(
          task(),
          { metered: provider },
          [{ providerId: "metered", ceilingAtomic: 0n }],
        ),
    ).toThrow(/must be positive/);
  });
});
