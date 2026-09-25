import { describe, expect, it } from "vitest";
import {
  CANALIS_LIVE_SANDBOX_MAX_TASK_ATOMIC,
  assertLiveSettlementAccounting,
  liveProviderAddress,
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
});
