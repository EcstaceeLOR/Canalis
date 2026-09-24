import { describe, expect, it } from "vitest";
import {
  DemoDataProvider,
  DemoInferenceProvider,
  DemoSearchProvider,
} from "@canalis/providers";
import {
  CanalisRouteOrchestrator,
  type Task,
} from "../src/index.js";

const providers = {
  search: new DemoSearchProvider(),
  data: new DemoDataProvider(),
  inference: new DemoInferenceProvider(),
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-route-1",
    owner: "owner-1",
    agentId: "agent-1",
    budget: { mint: "USDC", totalAtomic: 300_000n },
    policy: {
      allowedProviderIds: ["search", "data", "inference"],
      maxPerCallAtomic: 150_000n,
      providerCapsAtomic: {
        search: 100_000n,
        data: 30_000n,
        inference: 120_000n,
      },
    },
    status: "active",
    createdAtUnixSeconds: 1_000n,
    expiresAtUnixSeconds: 10_000n,
    ...overrides,
  };
}

const reservations = [
  { providerId: "search", ceilingAtomic: 100_000n },
  { providerId: "data", ceilingAtomic: 30_000n },
  { providerId: "inference", ceilingAtomic: 120_000n },
] as const;

describe("CanalisRouteOrchestrator", () => {
  it("rejects aggregate channel reservations above the task budget", () => {
    expect(
      () =>
        new CanalisRouteOrchestrator(makeTask(), providers, [
          { providerId: "search", ceilingAtomic: 100_000n },
          { providerId: "data", ceilingAtomic: 30_000n },
          { providerId: "inference", ceilingAtomic: 171_000n },
        ]),
    ).toThrow(/provider cap|task budget/);
  });

  it("executes a three-provider task and builds one payment graph", async () => {
    let now = 2_000n;
    const orchestrator = new CanalisRouteOrchestrator(
      makeTask(),
      providers,
      reservations,
      () => now++,
    );

    const search = await orchestrator.execute("search", {
      requestId: "search-1",
      input: { query: "Solana payment channels" },
    });
    const data = await orchestrator.execute("data", {
      requestId: "data-1",
      input: { key: "SOL-USDC" },
    });
    const inference = await orchestrator.execute("inference", {
      requestId: "inference-1",
      input: { prompt: "Synthesize the evidence" },
    });

    expect(search.ok).toBe(true);
    expect(data.ok).toBe(true);
    expect(inference.ok).toBe(true);

    const graph = orchestrator.getPaymentGraph();
    expect(graph.reservedCeilingAtomic).toBe(250_000n);
    expect(graph.spentAtomic).toBe(200_000n);
    expect(graph.remainingAtomic).toBe(100_000n);
    expect(graph.flows).toHaveLength(3);
    expect(graph.flows.every((flow) => flow.status === "fulfilled")).toBe(true);
    expect(graph.flows.every((flow) => flow.receipt?.responseHash.length === 64)).toBe(true);

    expect(
      graph.providers.find((provider) => provider.providerId === "search")
        ?.cumulativeAuthorizedAtomic,
    ).toBe(50_000n);
    expect(
      graph.providers.find((provider) => provider.providerId === "data")
        ?.cumulativeAuthorizedAtomic,
    ).toBe(30_000n);
    expect(
      graph.providers.find((provider) => provider.providerId === "inference")
        ?.cumulativeAuthorizedAtomic,
    ).toBe(120_000n);
  });

  it("records a rejected flow instead of returning paid work", async () => {
    const task = makeTask({
      policy: {
        allowedProviderIds: ["inference"],
        maxPerCallAtomic: 100_000n,
        providerCapsAtomic: { inference: 120_000n },
      },
    });
    const orchestrator = new CanalisRouteOrchestrator(
      task,
      providers,
      [{ providerId: "inference", ceilingAtomic: 120_000n }],
      () => 2_000n,
    );

    const result = await orchestrator.execute("inference", {
      requestId: "too-expensive",
      input: { prompt: "This must be rejected before fulfillment" },
    });

    expect(result.ok).toBe(false);
    expect(result.flow.status).toBe("rejected");
    expect(result.flow.rejectionCode).toBe("PER_CALL_CAP_EXCEEDED");

    const graph = orchestrator.getPaymentGraph();
    expect(graph.spentAtomic).toBe(0n);
    expect(graph.remainingAtomic).toBe(task.budget.totalAtomic);
  });

  it("rejects a registered provider that has no reserved task channel", async () => {
    const orchestrator = new CanalisRouteOrchestrator(
      makeTask(),
      providers,
      [{ providerId: "search", ceilingAtomic: 100_000n }],
      () => 2_000n,
    );

    const result = await orchestrator.execute("data", {
      requestId: "unreserved-data",
      input: { key: "volume" },
    });

    expect(result.ok).toBe(false);
    expect(result.flow.rejectionCode).toBe("PROVIDER_NOT_RESERVED");
    expect(orchestrator.getPaymentGraph().spentAtomic).toBe(0n);
  });

  it("advances cumulative provider authorization and rejects ceiling overflow", async () => {
    const orchestrator = new CanalisRouteOrchestrator(
      makeTask(),
      providers,
      [{ providerId: "search", ceilingAtomic: 100_000n }],
      () => 2_000n,
    );

    const first = await orchestrator.execute("search", {
      requestId: "search-1",
      input: { query: "first" },
    });
    const second = await orchestrator.execute("search", {
      requestId: "search-2",
      input: { query: "second" },
    });
    const third = await orchestrator.execute("search", {
      requestId: "search-3",
      input: { query: "third" },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(false);
    expect(third.flow.rejectionCode).toBe("CHANNEL_CEILING_EXCEEDED");

    const graph = orchestrator.getPaymentGraph();
    expect(graph.spentAtomic).toBe(100_000n);
    expect(
      graph.providers.find((provider) => provider.providerId === "search")
        ?.cumulativeAuthorizedAtomic,
    ).toBe(100_000n);
  });

  it("links fulfilled flows to an eventual settlement transaction", async () => {
    const orchestrator = new CanalisRouteOrchestrator(
      makeTask(),
      providers,
      [{ providerId: "search", ceilingAtomic: 100_000n }],
      () => 2_000n,
    );

    await orchestrator.execute("search", {
      requestId: "search-settlement",
      input: { query: "settlement" },
    });

    orchestrator.recordSettlement({
      providerId: "search",
      cumulativeAmountAtomic: 50_000n,
      transactionSignature: "demo-solana-signature",
    });

    const graph = orchestrator.getPaymentGraph();
    expect(graph.settlements).toEqual([
      {
        providerId: "search",
        cumulativeAmountAtomic: 50_000n,
        transactionSignature: "demo-solana-signature",
      },
    ]);
    expect(graph.flows[0]?.settlementTransactionSignature).toBe(
      "demo-solana-signature",
    );
  });

  it("refuses to record settlement above authorized cumulative spend", async () => {
    const orchestrator = new CanalisRouteOrchestrator(
      makeTask(),
      providers,
      [{ providerId: "search", ceilingAtomic: 100_000n }],
      () => 2_000n,
    );

    await orchestrator.execute("search", {
      requestId: "search-settlement-limit",
      input: { query: "limit" },
    });

    expect(() =>
      orchestrator.recordSettlement({
        providerId: "search",
        cumulativeAmountAtomic: 50_001n,
        transactionSignature: "invalid",
      }),
    ).toThrow(/cannot exceed cumulative authorized spend/);
  });
});
