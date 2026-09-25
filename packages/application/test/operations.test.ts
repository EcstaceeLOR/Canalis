import { describe, expect, it } from "vitest";
import { ApplicationError } from "../src/errors.js";
import { parseOperationsAnalyticsRange } from "../src/operations.js";

const NOW = 2_000_000_000n;

describe("operational analytics ranges", () => {
  it("resolves the supported presets into bounded buckets", () => {
    const daily = parseOperationsAnalyticsRange(new URL("https://canalis.test/api/analytics?range=24h"), NOW);
    expect(daily.fromUnixSeconds).toBe(NOW - 86_400n);
    expect(daily.toUnixSeconds).toBe(NOW);
    expect(daily.bucketSeconds).toBe(3_600);

    const weekly = parseOperationsAnalyticsRange(new URL("https://canalis.test/api/analytics?range=7d"), NOW);
    expect(weekly.fromUnixSeconds).toBe(NOW - 604_800n);
    expect(weekly.bucketSeconds).toBe(21_600);

    const monthly = parseOperationsAnalyticsRange(new URL("https://canalis.test/api/analytics?range=30d"), NOW);
    expect(monthly.fromUnixSeconds).toBe(NOW - 2_592_000n);
    expect(monthly.bucketSeconds).toBe(86_400);
  });

  it("supports explicit custom ranges and scales bucket size", () => {
    const from = NOW - 10n * 86_400n;
    const custom = parseOperationsAnalyticsRange(
      new URL(`https://canalis.test/api/analytics?range=custom&from=${from}&to=${NOW}`),
      NOW,
    );
    expect(custom.preset).toBe("custom");
    expect(custom.fromUnixSeconds).toBe(from);
    expect(custom.toUnixSeconds).toBe(NOW);
    expect(custom.bucketSeconds).toBe(21_600);
  });

  it("rejects invalid, future, and unbounded custom ranges", () => {
    expect(() => parseOperationsAnalyticsRange(new URL("https://canalis.test/api/analytics?range=quarter"), NOW)).toThrow(ApplicationError);
    expect(() => parseOperationsAnalyticsRange(new URL(`https://canalis.test/api/analytics?range=custom&from=${NOW}&to=${NOW - 1n}`), NOW)).toThrow(ApplicationError);
    expect(() => parseOperationsAnalyticsRange(new URL(`https://canalis.test/api/analytics?range=custom&from=${NOW - 1000n}&to=${NOW + 1000n}`), NOW)).toThrow(ApplicationError);
    expect(() => parseOperationsAnalyticsRange(new URL(`https://canalis.test/api/analytics?range=custom&from=${NOW - 367n * 86_400n}&to=${NOW}`), NOW)).toThrow(ApplicationError);
  });
});
