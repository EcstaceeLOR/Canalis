import { describe, expect, it } from "vitest";
import { MppProviderAdapter } from "@canalis/providers";
import { CanalisRouteOrchestrator, type Task } from "../src/index.js";

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function mppChallenge(amount: string): string {
  return [
    'Payment id="challenge-canalis"',
    'realm="provider"',
    'method="tempo"',
    'intent="charge"',
    `request="${base64UrlJson({
      amount,
      currency: "USDC",
      recipient: "provider-wallet",
    })}"`,
  ].join(", ");
}

function makeTask(maxPerCallAtomic: bigint): Task {
  return {
    id: "task-mpp-route",
    owner: "owner",
    agentId: "agent",
    budget: { mint: "USDC", totalAtomic: 1_000n },
    policy: {
      allowedProviderIds: ["mpp"],
      maxPerCallAtomic,
      providerCapsAtomic: { mpp: 500n },
    },
    status: "active",
    createdAtUnixSeconds: 1n,
    expiresAtUnixSeconds: 10_000n,
  };
}

describe("protocol-backed Canalis route", () => {
  it("blocks an MPP paid fetch when the task policy rejects the quote", async () => {
    let paidCalls = 0;
    const provider = new MppProviderAdapter<unknown, { ok: boolean }>({
      metadata: {
        id: "mpp",
        name: "MPP provider",
        payee: "provider-wallet",
        description: "policy ordering test",
      },
      unpaidFetch: async () =>
        new Response("", {
          status: 402,
          headers: { "WWW-Authenticate": mppChallenge("200") },
        }),
      paidFetch: async () => {
        paidCalls += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      buildRequest: () => ({ url: "https://provider.test/paid" }),
    });

    const orchestrator = new CanalisRouteOrchestrator(
      makeTask(100n),
      { mpp: provider },
      [{ providerId: "mpp", ceilingAtomic: 500n }],
      () => 100n,
    );

    const result = await orchestrator.execute("mpp", {
      requestId: "blocked-mpp",
      input: null,
    });

    expect(result.ok).toBe(false);
    expect(result.flow.rejectionCode).toBe("PER_CALL_CAP_EXCEEDED");
    expect(paidCalls).toBe(0);
    expect(orchestrator.getPaymentGraph().spentAtomic).toBe(0n);
  });

  it("stores MPP receipt metadata in the normal task payment graph", async () => {
    const receipt = base64UrlJson({
      challengeId: "challenge-paid",
      method: "tempo",
      status: "success",
      reference: "tempo-reference",
      timestamp: "2026-09-24T16:00:00Z",
      network: "eip155:4217",
    });
    const provider = new MppProviderAdapter<unknown, { ok: boolean }>({
      metadata: {
        id: "mpp",
        name: "MPP provider",
        payee: "provider-wallet",
        description: "receipt graph test",
      },
      unpaidFetch: async () =>
        new Response("", {
          status: 402,
          headers: { "WWW-Authenticate": mppChallenge("200") },
        }),
      paidFetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "Payment-Receipt": receipt,
          },
        }),
      buildRequest: () => ({ url: "https://provider.test/paid" }),
    });

    const orchestrator = new CanalisRouteOrchestrator(
      makeTask(300n),
      { mpp: provider },
      [{ providerId: "mpp", ceilingAtomic: 500n }],
      () => 200n,
    );

    const result = await orchestrator.execute("mpp", {
      requestId: "paid-mpp",
      input: null,
    });

    expect(result.ok).toBe(true);
    const graph = orchestrator.getPaymentGraph();
    expect(graph.spentAtomic).toBe(200n);
    expect(graph.flows[0]?.receipt?.protocol).toBe("mpp");
    expect(graph.flows[0]?.receipt?.protocolMetadata).toMatchObject({
      "mpp.reference": "tempo-reference",
      "mpp.network": "eip155:4217",
      "mpp.intent": "charge",
    });
  });
});
