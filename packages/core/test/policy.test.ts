import { describe, expect, it } from "vitest";
import {
  applyApprovedSpend,
  evaluateSpend,
  type SpendProposal,
  type Task,
  type TaskLedger,
} from "../src/index.js";

const task: Task = {
  id: "task-1",
  owner: "owner-1",
  agentId: "agent-1",
  budget: {
    mint: "USDC",
    totalAtomic: 1_000_000n,
  },
  policy: {
    allowedProviderIds: ["search", "data", "inference"],
    maxPerCallAtomic: 250_000n,
    providerCapsAtomic: {
      search: 300_000n,
      data: 200_000n,
      inference: 700_000n,
    },
  },
  status: "active",
  createdAtUnixSeconds: 1_000n,
  expiresAtUnixSeconds: 10_000n,
};

const ledger: TaskLedger = {
  taskId: task.id,
  spentAtomic: 100_000n,
  providerSpentAtomic: {
    search: 100_000n,
  },
};

function proposal(overrides: Partial<SpendProposal> = {}): SpendProposal {
  return {
    task,
    ledger,
    providerId: "search",
    quotedAmountAtomic: 50_000n,
    currentProviderCumulativeAtomic: 100_000n,
    nextProviderCumulativeAtomic: 150_000n,
    channelCeilingAtomic: 300_000n,
    nowUnixSeconds: 2_000n,
    ...overrides,
  };
}

function expectRejected(
  result: ReturnType<typeof evaluateSpend>,
  code: string,
): void {
  expect(result.allowed).toBe(false);
  if (!result.allowed) {
    expect(result.code).toBe(code);
    expect(result.message.length).toBeGreaterThan(0);
  }
}

describe("evaluateSpend", () => {
  it("allows a valid spend and returns projected ledger values", () => {
    const result = evaluateSpend(proposal());

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.amountAtomic).toBe(50_000n);
      expect(result.projectedTaskSpendAtomic).toBe(150_000n);
      expect(result.projectedProviderSpendAtomic).toBe(150_000n);
      expect(result.nextProviderCumulativeAtomic).toBe(150_000n);
    }
  });

  it("allows exact boundary values for per-call, provider and task caps", () => {
    const boundaryLedger: TaskLedger = {
      taskId: task.id,
      spentAtomic: 750_000n,
      providerSpentAtomic: { inference: 450_000n },
    };

    const result = evaluateSpend(
      proposal({
        ledger: boundaryLedger,
        providerId: "inference",
        quotedAmountAtomic: 250_000n,
        currentProviderCumulativeAtomic: 450_000n,
        nextProviderCumulativeAtomic: 700_000n,
        channelCeilingAtomic: 700_000n,
      }),
    );

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.projectedTaskSpendAtomic).toBe(1_000_000n);
      expect(result.projectedProviderSpendAtomic).toBe(700_000n);
    }
  });

  it("rejects a ledger belonging to another task", () => {
    expectRejected(
      evaluateSpend(
        proposal({ ledger: { ...ledger, taskId: "different-task" } }),
      ),
      "LEDGER_TASK_MISMATCH",
    );
  });

  it("rejects cancelled or completed tasks", () => {
    expectRejected(
      evaluateSpend(proposal({ task: { ...task, status: "cancelled" } })),
      "TASK_NOT_ACTIVE",
    );
    expectRejected(
      evaluateSpend(proposal({ task: { ...task, status: "completed" } })),
      "TASK_NOT_ACTIVE",
    );
  });

  it("rejects an expired task at the exact expiry timestamp", () => {
    expectRejected(
      evaluateSpend(proposal({ nowUnixSeconds: task.expiresAtUnixSeconds })),
      "TASK_EXPIRED",
    );
  });

  it("treats zero task expiry as no expiry", () => {
    const result = evaluateSpend(
      proposal({
        task: { ...task, expiresAtUnixSeconds: 0n },
        nowUnixSeconds: 999_999_999n,
      }),
    );

    expect(result.allowed).toBe(true);
  });

  it("rejects zero and negative quoted amounts", () => {
    expectRejected(
      evaluateSpend(
        proposal({
          quotedAmountAtomic: 0n,
          nextProviderCumulativeAtomic: 100_000n,
        }),
      ),
      "INVALID_AMOUNT",
    );
    expectRejected(
      evaluateSpend(
        proposal({
          quotedAmountAtomic: -1n,
          nextProviderCumulativeAtomic: 99_999n,
        }),
      ),
      "INVALID_AMOUNT",
    );
  });

  it("rejects providers outside the allowlist", () => {
    expectRejected(
      evaluateSpend(proposal({ providerId: "unknown-provider" })),
      "PROVIDER_NOT_ALLOWED",
    );
  });

  it("rejects one atomic unit above the per-call cap", () => {
    expectRejected(
      evaluateSpend(
        proposal({
          quotedAmountAtomic: 250_001n,
          currentProviderCumulativeAtomic: 0n,
          nextProviderCumulativeAtomic: 250_001n,
          channelCeilingAtomic: 300_000n,
        }),
      ),
      "PER_CALL_CAP_EXCEEDED",
    );
  });

  it("rejects replayed or decreasing cumulative vouchers", () => {
    expectRejected(
      evaluateSpend(
        proposal({
          currentProviderCumulativeAtomic: 100_000n,
          nextProviderCumulativeAtomic: 100_000n,
        }),
      ),
      "NON_MONOTONIC_VOUCHER",
    );
    expectRejected(
      evaluateSpend(
        proposal({
          currentProviderCumulativeAtomic: 100_000n,
          nextProviderCumulativeAtomic: 99_999n,
        }),
      ),
      "NON_MONOTONIC_VOUCHER",
    );
  });

  it("rejects a voucher increase that does not equal the quoted price", () => {
    expectRejected(
      evaluateSpend(
        proposal({
          quotedAmountAtomic: 50_000n,
          currentProviderCumulativeAtomic: 100_000n,
          nextProviderCumulativeAtomic: 160_000n,
        }),
      ),
      "VOUCHER_DELTA_MISMATCH",
    );
  });

  it("rejects cumulative authorization above the channel ceiling", () => {
    expectRejected(
      evaluateSpend(
        proposal({
          quotedAmountAtomic: 50_000n,
          currentProviderCumulativeAtomic: 260_000n,
          nextProviderCumulativeAtomic: 310_000n,
          channelCeilingAtomic: 300_000n,
        }),
      ),
      "CHANNEL_CEILING_EXCEEDED",
    );
  });

  it("rejects one atomic unit above a provider-level cap", () => {
    expectRejected(
      evaluateSpend(
        proposal({
          ledger: {
            ...ledger,
            providerSpentAtomic: { search: 250_001n },
          },
          quotedAmountAtomic: 50_000n,
          currentProviderCumulativeAtomic: 250_001n,
          nextProviderCumulativeAtomic: 300_001n,
          channelCeilingAtomic: 400_000n,
        }),
      ),
      "PROVIDER_CAP_EXCEEDED",
    );
  });

  it("rejects one atomic unit above the total task budget", () => {
    expectRejected(
      evaluateSpend(
        proposal({
          ledger: {
            taskId: task.id,
            spentAtomic: 950_001n,
            providerSpentAtomic: { search: 100_000n },
          },
          quotedAmountAtomic: 50_000n,
          currentProviderCumulativeAtomic: 100_000n,
          nextProviderCumulativeAtomic: 150_000n,
        }),
      ),
      "TASK_BUDGET_EXCEEDED",
    );
  });
});

describe("applyApprovedSpend", () => {
  it("returns a new ledger with task and provider spend advanced", () => {
    const decision = evaluateSpend(proposal());
    const nextLedger = applyApprovedSpend(ledger, "search", decision);

    expect(nextLedger).not.toBe(ledger);
    expect(nextLedger.spentAtomic).toBe(150_000n);
    expect(nextLedger.providerSpentAtomic.search).toBe(150_000n);
    expect(ledger.spentAtomic).toBe(100_000n);
  });

  it("refuses to apply a rejected decision", () => {
    const rejected = evaluateSpend(proposal({ providerId: "blocked" }));
    expect(() => applyApprovedSpend(ledger, "blocked", rejected)).toThrow(
      /cannot apply rejected policy decision/,
    );
  });
});
