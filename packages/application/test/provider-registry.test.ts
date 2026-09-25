import { describe, expect, it } from "vitest";
import {
  assertProviderSelectable,
  parseProviderRegistryCreate,
  parseProviderRegistryUpdate,
  providerSelectable,
  type ProviderRegistryRecord,
} from "../src/index.js";

function record(overrides: Partial<ProviderRegistryRecord> = {}): ProviderRegistryRecord {
  return {
    id: "weather-x402",
    name: "Weather x402",
    description: "Paid weather intelligence",
    protocol: "x402",
    mode: "x402",
    endpoint: "https://weather.example/resource",
    payee: "provider-wallet",
    ownerWallet: "owner-wallet",
    systemManaged: false,
    status: "active",
    healthStatus: "healthy",
    supportedNetworks: ["solana:devnet"],
    supportedAssets: ["USDC"],
    pricingModel: "challenge",
    policyMetadata: {},
    hasCredential: false,
    createdAtUnixSeconds: "1800000000",
    updatedAtUnixSeconds: "1800000000",
    usage: { tasks: 0, channels: 0, flows: 0 },
    ...overrides,
  };
}

describe("provider registry contracts", () => {
  it("requires live provider endpoints and protocol constraints", () => {
    expect(() =>
      parseProviderRegistryCreate({
        id: "weather-x402",
        name: "Weather x402",
        description: "Paid weather intelligence",
        protocol: "x402",
        payee: "provider-wallet",
        supportedNetworks: [],
        supportedAssets: [],
        pricingModel: "challenge",
        policyMetadata: {},
      }),
    ).toThrow(/endpoint/i);

    const parsed = parseProviderRegistryCreate({
      id: "weather-x402",
      name: "Weather x402",
      description: "Paid weather intelligence",
      protocol: "x402",
      endpoint: "https://weather.example/resource",
      payee: "provider-wallet",
      supportedNetworks: ["solana:devnet"],
      supportedAssets: ["USDC"],
      pricingModel: "challenge",
      policyMetadata: {},
    });
    expect(parsed.protocol).toBe("x402");
    expect(parsed.endpoint).toBe("https://weather.example/resource");
  });

  it("requires positive fixed pricing and API-key header metadata", () => {
    expect(() =>
      parseProviderRegistryCreate({
        id: "fixed-data",
        name: "Fixed data",
        description: "Fixed-price endpoint",
        protocol: "x402",
        endpoint: "https://data.example/resource",
        payee: "provider-wallet",
        supportedNetworks: ["solana:devnet"],
        supportedAssets: ["USDC"],
        pricingModel: "fixed",
        fixedPriceUsd: "0",
        policyMetadata: {},
      }),
    ).toThrow(/greater than zero/i);

    expect(() =>
      parseProviderRegistryUpdate({
        credential: { kind: "api-key", secret: "secret-value" },
      }),
    ).toThrow(/header name/i);
  });

  it("blocks disabled or unhealthy live providers from task selection", () => {
    expect(providerSelectable(record())).toBe(true);
    expect(providerSelectable(record({ status: "disabled" }))).toBe(false);
    expect(providerSelectable(record({ healthStatus: "unknown" }))).toBe(false);
    expect(() => assertProviderSelectable(record({ healthStatus: "unhealthy" }))).toThrow(
      /health/i,
    );
  });

  it("allows in-process demo providers unless explicitly unhealthy", () => {
    expect(providerSelectable(record({ protocol: "demo", mode: "deterministic", healthStatus: "unknown" }))).toBe(true);
    expect(providerSelectable(record({ protocol: "demo", mode: "deterministic", healthStatus: "unhealthy" }))).toBe(false);
  });
});
