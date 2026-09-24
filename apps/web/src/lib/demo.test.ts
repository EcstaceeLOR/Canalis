import { describe, expect, it } from "vitest";
import {
  allocateDemoReservations,
  demoDefaults,
  runDemoTask,
} from "./demo";
import { formatUsdcAtomic, parseUsdc } from "./money";

describe("USDC helpers", () => {
  it("parses USDC without floating-point arithmetic", () => {
    expect(parseUsdc("1")).toBe(1_000_000n);
    expect(parseUsdc("1.25")).toBe(1_250_000n);
    expect(parseUsdc("0.000001")).toBe(1n);
    expect(parseUsdc(" 42.100000 ")).toBe(42_100_000n);
  });

  it("rejects invalid precision and non-numeric values", () => {
    expect(() => parseUsdc("0.0000001")).toThrow(/valid USDC amount/);
    expect(() => parseUsdc("1e3")).toThrow(/valid USDC amount/);
    expect(() => parseUsdc("-1")).toThrow(/valid USDC amount/);
  });

  it("formats atomic USDC for the dashboard", () => {
    expect(formatUsdcAtomic(1_250_000n)).toBe("1.25");
    expect(formatUsdcAtomic(1_000_000n)).toBe("1");
    expect(formatUsdcAtomic(5_000n, 3)).toBe("0.005");
  });
});

describe("demo channel allocation", () => {
  it("reserves exactly the task budget across selected providers", () => {
    const reservations = allocateDemoReservations(1_000_000n, [
      "search",
      "data",
      "inference",
    ]);

    expect(
      reservations.reduce((sum, reservation) => sum + reservation.ceilingAtomic, 0n),
    ).toBe(1_000_000n);
    expect(
      reservations.find((reservation) => reservation.providerId === "search")
        ?.ceilingAtomic,
    ).toBeGreaterThanOrEqual(50_000n);
    expect(
      reservations.find((reservation) => reservation.providerId === "data")
        ?.ceilingAtomic,
    ).toBeGreaterThanOrEqual(30_000n);
    expect(
      reservations.find((reservation) => reservation.providerId === "inference")
        ?.ceilingAtomic,
    ).toBeGreaterThanOrEqual(120_000n);
  });

  it("rejects a budget below the selected providers' minimum prices", () => {
    expect(() =>
      allocateDemoReservations(199_999n, ["search", "data", "inference"]),
    ).toThrow(/Budget is too small/);
  });
});

describe("runDemoTask", () => {
  it("pins the Colosseum judge seed to the documented 1.00 / 0.25 flow", async () => {
    const result = await runDemoTask(
      {
        owner: demoDefaults.owner,
        budgetUsd: demoDefaults.budgetUsd,
        maxPerCallUsd: demoDefaults.maxPerCallUsd,
        allowedProviders: [...demoDefaults.allowedProviders],
      },
      10_000n,
    );

    expect(result.demo).toEqual({
      mode: "deterministic",
      seed: "cwf-2026-v1",
    });
    expect(result.graph.budgetAtomic).toBe(1_000_000n);
    expect(result.graph.spentAtomic).toBe(200_000n);
    expect(result.graph.remainingAtomic).toBe(800_000n);
  });

  it("runs the three-provider Canalis vertical slice", async () => {
    const result = await runDemoTask(
      {
        owner: "wallet-public-key",
        budgetUsd: "1.00",
        maxPerCallUsd: "0.25",
        allowedProviders: ["search", "data", "inference"],
      },
      10_000n,
    );

    expect(result.task.owner).toBe("wallet-public-key");
    expect(result.graph.budgetAtomic).toBe(1_000_000n);
    expect(result.graph.spentAtomic).toBe(200_000n);
    expect(result.graph.remainingAtomic).toBe(800_000n);
    expect(result.graph.flows).toHaveLength(3);
    expect(result.graph.flows.map((flow) => flow.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    expect(result.graph.flows.map((flow) => flow.providerId)).toEqual([
      "search",
      "data",
      "inference",
    ]);
    expect(
      result.graph.flows.every((flow) => flow.receipt?.responseHash.length === 64),
    ).toBe(true);
    expect(result.settlement.authorizedSpendAtomic).toBe(200_000n);
    expect(result.settlement.recoverableAtomic).toBe(800_000n);
    expect(result.settlement.status).toBe("awaiting-onchain-finalization");
  });

  it("shows a policy-blocked inference call without charging for it", async () => {
    const result = await runDemoTask(
      {
        budgetUsd: "1.00",
        maxPerCallUsd: "0.10",
        allowedProviders: ["search", "data", "inference"],
      },
      20_000n,
    );

    expect(result.graph.spentAtomic).toBe(80_000n);
    expect(result.graph.remainingAtomic).toBe(920_000n);

    const inference = result.graph.flows.find(
      (flow) => flow.providerId === "inference",
    );
    expect(inference?.status).toBe("rejected");
    expect(inference?.rejectionCode).toBe("PER_CALL_CAP_EXCEEDED");
    expect(inference?.receipt).toBeUndefined();
  });

  it("supports a task containing only one approved provider", async () => {
    const result = await runDemoTask(
      {
        budgetUsd: "0.50",
        maxPerCallUsd: "0.10",
        allowedProviders: ["search"],
      },
      30_000n,
    );

    expect(result.graph.providers).toHaveLength(1);
    expect(result.graph.providers[0]?.providerId).toBe("search");
    expect(result.graph.providers[0]?.channelCeilingAtomic).toBe(500_000n);
    expect(result.graph.spentAtomic).toBe(50_000n);
    expect(result.graph.remainingAtomic).toBe(450_000n);
  });
});
