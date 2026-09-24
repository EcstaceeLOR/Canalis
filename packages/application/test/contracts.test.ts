import { describe, expect, it } from "vitest";
import { parseCreateTaskRequest, parseUsdc } from "../src/index.js";

describe("application contracts", () => {
  it("parses USDC without floating point arithmetic", () => {
    expect(parseUsdc("1.000001")).toBe(1_000_001n);
    expect(parseUsdc("0.25")).toBe(250_000n);
  });

  it("rejects unknown fields and invalid providers", () => {
    expect(() => parseCreateTaskRequest({ budgetUsd: "1.00", surprise: true })).toThrow();
    expect(() => parseCreateTaskRequest({ allowedProviders: ["unknown"] })).toThrow();
  });
});
