import { describe, expect, it } from "vitest";
import {
  buildTaskTimeline,
  hasPartialFailure,
  solanaExplorerAddressUrl,
  solanaExplorerTxUrl,
  type TaskDetailPayload,
} from "./task-detail-model";

const basePayload: TaskDetailPayload = {
  task: {
    id: "task_1",
    owner: "wallet_1",
    agentId: "agent",
    mode: "deterministic",
    status: "completed",
    mint: "USDC",
    budgetAtomic: "1000000",
    allowedProviders: ["search"],
    blockedProviders: [],
    maxPerCallAtomic: "250000",
    providerCapsAtomic: {},
    allowedNetworks: [],
    allowedMints: ["USDC"],
    allowedProtocols: ["demo"],
    policySourceName: "Inline bounded policy",
    policyOverrides: {},
    createdAtUnixSeconds: "100",
    expiresAtUnixSeconds: "1000",
  },
  graph: {
    taskId: "task_1",
    mint: "USDC",
    budgetAtomic: "1000000",
    spentAtomic: "50000",
    remainingAtomic: "950000",
    reservedCeilingAtomic: "1000000",
    providers: [{
      providerId: "search",
      channelCeilingAtomic: "1000000",
      cumulativeAuthorizedAtomic: "50000",
      spentAtomic: "50000",
    }],
    flows: [{
      id: "flow_1",
      taskId: "task_1",
      providerId: "search",
      requestId: "search-1",
      status: "fulfilled",
      quotedAmountAtomic: "50000",
      previousCumulativeAtomic: "0",
      nextCumulativeAtomic: "50000",
      authorizationId: "auth_1",
      paymentReference: "pay_1",
      receipt: {
        providerId: "search",
        requestId: "search-1",
        mint: "USDC",
        priceAtomic: "50000",
        protocol: "deterministic",
        authorizationId: "auth_1",
        paymentReference: "pay_1",
        responseHash: "hash_1",
        timestampUnixSeconds: "101",
      },
      createdAtUnixSeconds: "100",
    }],
    settlements: [],
  },
  channels: [{
    providerId: "search",
    programAddress: "CHNL",
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    status: "reserved",
    ceilingAtomic: "1000000",
    cumulativeAuthorizedAtomic: "50000",
    spentAtomic: "50000",
  }],
  settlement: {
    status: "awaiting-onchain-finalization",
    authorizedSpendAtomic: "50000",
    recoverableAtomic: "950000",
    transactions: [],
  },
  workspace: {
    id: "workspace_1",
    name: "Search task",
    description: "Test task",
    policyId: "inline-bounded",
    policyName: "Inline bounded policy",
    hasPolicyOverrides: false,
    updatedAtUnixSeconds: "102",
  },
};

describe("task detail model", () => {
  it("builds policy, request, quote, authorization and receipt events from persisted data", () => {
    const events = buildTaskTimeline(basePayload);
    expect(events.map((event) => event.stage)).toEqual([
      "task",
      "policy",
      "request",
      "quote",
      "authorization",
      "response",
      "task",
    ]);
    expect(events.find((event) => event.title === "Policy snapshot locked")?.evidence?.value).toBe("inline-bounded");
    expect(events.find((event) => event.title === "Response receipt stored")?.evidence?.value).toBe("hash_1");
  });

  it("does not fabricate explorer links without a real signature or address", () => {
    expect(solanaExplorerTxUrl(undefined, basePayload.channels[0].network)).toBeUndefined();
    expect(solanaExplorerAddressUrl(undefined, basePayload.channels[0].network)).toBeUndefined();
  });

  it("uses devnet explorer links only when real evidence exists", () => {
    expect(solanaExplorerTxUrl("real_signature", basePayload.channels[0].network)).toBe(
      "https://explorer.solana.com/tx/real_signature?cluster=devnet",
    );
    expect(solanaExplorerAddressUrl("real_channel", basePayload.channels[0].network)).toBe(
      "https://explorer.solana.com/address/real_channel?cluster=devnet",
    );
  });

  it("detects an active partial failure for guided containment", () => {
    const payload: TaskDetailPayload = {
      ...basePayload,
      task: { ...basePayload.task, status: "active" },
      graph: {
        ...basePayload.graph,
        flows: [{ ...basePayload.graph.flows[0], status: "failed", errorMessage: "provider timeout" }],
      },
    };
    expect(hasPartialFailure(payload)).toBe(true);
  });
});
