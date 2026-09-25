import { describe, expect, it } from "vitest";
import { evaluateSpend, type SpendProposal, type Task } from "../src/index.js";

const task: Task = {
  id: "task-policy-constraints",
  owner: "owner",
  agentId: "agent",
  budget: { mint: "mint-usdc", totalAtomic: 1_000_000n },
  policy: {
    allowedProviderIds: ["search"],
    blockedProviderIds: [],
    maxPerCallAtomic: 250_000n,
    providerCapsAtomic: { search: 500_000n },
    allowedNetworks: ["solana:devnet"],
    allowedMints: ["mint-usdc"],
    allowedProtocols: ["x402"],
  },
  status: "active",
  createdAtUnixSeconds: 1n,
  expiresAtUnixSeconds: 10_000n,
};

function proposal(overrides: Partial<SpendProposal> = {}): SpendProposal {
  return {
    task,
    ledger: { taskId: task.id, spentAtomic: 0n, providerSpentAtomic: {} },
    providerId: "search",
    quotedAmountAtomic: 50_000n,
    currentProviderCumulativeAtomic: 0n,
    nextProviderCumulativeAtomic: 50_000n,
    channelCeilingAtomic: 500_000n,
    nowUnixSeconds: 100n,
    mint: "mint-usdc",
    network: "solana:devnet",
    protocol: "x402",
    ...overrides,
  };
}

function code(result: ReturnType<typeof evaluateSpend>) {
  expect(result.allowed).toBe(false);
  return result.allowed ? "" : result.code;
}

describe("extended task policy constraints", () => {
  it("accepts a spend that satisfies provider, protocol, network and asset rules", () => {
    expect(evaluateSpend(proposal()).allowed).toBe(true);
  });

  it("blocks an explicitly blocked provider before authorization", () => {
    expect(code(evaluateSpend(proposal({ task: { ...task, policy: { ...task.policy, blockedProviderIds: ["search"] } } })))).toBe("PROVIDER_BLOCKED");
  });

  it("rejects a protocol outside the policy snapshot", () => {
    expect(code(evaluateSpend(proposal({ protocol: "mpp" })))).toBe("PROTOCOL_NOT_ALLOWED");
  });

  it("rejects a network outside the policy snapshot", () => {
    expect(code(evaluateSpend(proposal({ network: "solana:mainnet" })))).toBe("NETWORK_NOT_ALLOWED");
  });

  it("rejects a missing network when the policy requires one", () => {
    expect(code(evaluateSpend(proposal({ network: undefined })))).toBe("NETWORK_NOT_ALLOWED");
  });

  it("rejects an asset outside the policy snapshot", () => {
    expect(code(evaluateSpend(proposal({ mint: "other-mint" })))).toBe("MINT_NOT_ALLOWED");
  });
});
