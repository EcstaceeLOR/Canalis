import { describe, expect, it } from "vitest";
import {
  mergePolicyRules,
  parseReusablePolicyCreate,
  parseTaskPolicyOverrides,
  validatePolicyRules,
} from "../src/index.js";

const base = {
  totalCeilingUsd: "1.00",
  maxPerCallUsd: "0.25",
  allowedProviders: ["search", "data"],
  blockedProviders: [],
  providerCapsUsd: { search: "0.60", data: "0.50" },
  durationMinutes: 60,
  allowedNetworks: [],
  allowedMints: ["USDC"],
  allowedProtocols: ["demo"] as const,
};

describe("reusable policy contracts", () => {
  it("accepts a complete reusable policy", () => {
    const parsed = parseReusablePolicyCreate({ name: "Research guardrails", description: "Bounded spend", rules: base });
    expect(parsed.rules.totalCeilingUsd).toBe("1.00");
    expect(parsed.rules.providerCapsUsd.search).toBe("0.60");
  });

  it("rejects per-call limits above the task ceiling", () => {
    expect(() => validatePolicyRules({ ...base, maxPerCallUsd: "1.01" })).toThrow(/per-call ceiling/i);
  });

  it("rejects allow/block conflicts", () => {
    expect(() => validatePolicyRules({ ...base, blockedProviders: ["search"] })).toThrow(/both allowed and blocked/i);
  });

  it("rejects provider caps for providers outside the allowlist", () => {
    expect(() => validatePolicyRules({ ...base, providerCapsUsd: { search: "0.60", inference: "0.40" } })).toThrow(/must reference an allowed provider/i);
  });

  it("rejects cap combinations that cannot cover the total ceiling", () => {
    expect(() => validatePolicyRules({ ...base, providerCapsUsd: { search: "0.40", data: "0.40" } })).toThrow(/collectively cover/i);
  });

  it("merges only explicit task overrides and revalidates the result", () => {
    const overrides = parseTaskPolicyOverrides({ totalCeilingUsd: "0.75", maxPerCallUsd: "0.20", durationMinutes: 30 });
    const merged = mergePolicyRules(validatePolicyRules(base), overrides);
    expect(merged.totalCeilingUsd).toBe("0.75");
    expect(merged.maxPerCallUsd).toBe("0.20");
    expect(merged.durationMinutes).toBe(30);
    expect(merged.allowedProviders).toEqual(["search", "data"]);
  });
});
