import { describe, expect, it } from "vitest";
import {
  CANALIS_LIVE_SANDBOX_MAX_TASK_ATOMIC,
  assertLiveSettlementAccounting,
  liveProviderAddress,
  recoverRateLimitedBroadcast,
  validateLivePaymentPayload,
} from "../src/live-x402.js";

const requirements = {
  scheme: "upto",
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const,
  asset: "BewPkz9eV7JpKJ2G6VfFpxhFqLtFTnxkoBQTzLRm8ott",
  amount: "100000",
  payTo: liveProviderAddress("search"),
  maxTimeoutSeconds: 900,
  extra: {},
};

describe("live x402 devnet helpers", () => {
  it("reconciles payout and refund to the fixed ceiling", () => {
    const result = assertLiveSettlementAccounting(100_000n, 30_000n);
    expect(result.settledAtomic).toBe(30_000n);
    expect(result.refundedAtomic).toBe(70_000n);
    expect(result.settledAtomic + result.refundedAtomic).toBe(100_000n);
  });

  it("rejects over-settlement", () => {
    expect(() => assertLiveSettlementAccounting(100n, 101n)).toThrow(/between zero and the channel ceiling/i);
  });

  it("uses stable provider receive addresses", () => {
    expect(liveProviderAddress("search")).toBe(liveProviderAddress("search"));
    expect(liveProviderAddress("search")).not.toBe(liveProviderAddress("data"));
  });

  it("binds signed payloads to the authenticated payer and prepared requirements", () => {
    const payer = "HAufDEZaeaexu8NXSyBzdfnLzLrJoyxa58zWSFPtvALf";
    const payload = {
      x402Version: 2,
      accepted: requirements,
      payload: {
        from: payer,
        channelId: "F5hPXLV3WRRaVNMrcM7PteNBCwf78wWhG1JfnQdAqmWH",
      },
    };
    expect(() => validateLivePaymentPayload(payload, requirements, payer)).not.toThrow();
    expect(() => validateLivePaymentPayload(payload, requirements, liveProviderAddress("inference"))).toThrow(/authenticated wallet/i);
  });

  it("keeps the built-in sandbox intentionally bounded", () => {
    expect(CANALIS_LIVE_SANDBOX_MAX_TASK_ATOMIC).toBe(5_000_000n);
  });

  it("confirms a broadcast signature after the RPC rate-limits confirmation", async () => {
    const getSignatureStatuses = async () => ({
      context: { slot: 1 },
      value: [{ err: null, confirmationStatus: "confirmed" as const }],
    });
    const recovered = await recoverRateLimitedBroadcast(
      { getSignatureStatuses } as never,
      {
        success: false,
        errorReason: "settlement_pending",
        errorMessage: "HTTP error (429): Too Many Requests",
        transaction: "46DeVdLddj7dDmd4oPUtX3ZJtBxsHFtk298g1URyTdDQGx9ZT3EniZb2VE6bA3DzFEQGbuAUNHcynzUoqUE2vbuz",
        network: requirements.network,
        payer: "HAufDEZaeaexu8NXSyBzdfnLzLrJoyxa58zWSFPtvALf",
      },
      { attempts: 1 },
    );

    expect(recovered.success).toBe(true);
    expect(recovered.transaction).toMatch(/^46De/);
    expect(recovered).not.toHaveProperty("errorMessage");
  });

  it("does not rebroadcast or invent success while a signature is unconfirmed", async () => {
    let polls = 0;
    const getSignatureStatuses = async () => {
      polls += 1;
      return { context: { slot: 1 }, value: [null] };
    };
    const failed = {
      success: false as const,
      errorReason: "settlement_pending",
      errorMessage: "HTTP error (429): Too Many Requests",
      transaction: "pending-signature",
      network: requirements.network,
      payer: "HAufDEZaeaexu8NXSyBzdfnLzLrJoyxa58zWSFPtvALf",
    };
    const recovered = await recoverRateLimitedBroadcast(
      { getSignatureStatuses } as never,
      failed,
      { attempts: 3, delayMs: 0, sleep: async () => undefined },
    );

    expect(polls).toBe(3);
    expect(recovered).toBe(failed);
    expect(recovered.success).toBe(false);
  });
});
