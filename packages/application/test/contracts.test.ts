import { describe, expect, it } from "vitest";
import { parseCreateTaskRequest, parseUsdc } from "../src/index.js";

describe("application contracts", () => {
  it("parses USDC without floating point arithmetic", () => {
    expect(parseUsdc("1.000001")).toBe(1_000_001n);
    expect(parseUsdc("0.25")).toBe(250_000n);
  });

  it("accepts stable provider registry IDs while rejecting malformed IDs", () => {
    expect(
      parseCreateTaskRequest({
        allowedProviders: ["search", "weather-x402.v1"],
        mode: "x402",
      }).allowedProviders,
    ).toEqual(["search", "weather-x402.v1"]);
    expect(() => parseCreateTaskRequest({ budgetUsd: "1.00", surprise: true })).toThrow();
    expect(() => parseCreateTaskRequest({ allowedProviders: ["bad provider!"] })).toThrow();
  });
});
