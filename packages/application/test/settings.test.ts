import { describe, expect, it } from "vitest";
import {
  ApplicationError,
  assertIntegrationCompatible,
  assertTaskCompatibleWithSettings,
  defaultAccountSettings,
  parseAccountSettings,
} from "../src/index.js";

const owner = "wallet-settings-test";

function input(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Operations",
    environment: "devnet",
    solanaNetwork: "devnet",
    defaultAssetSymbol: "USDC",
    defaultAssetMint: "",
    explorerCluster: "devnet",
    taskDefaults: { agentId: "agent-1", executionMode: "x402", defaultPolicyId: "", saveAsDraft: false },
    notifications: { taskFailures: true, providerIncidents: true, settlementFailures: true, recoveryRequired: true },
    product: { autoRefreshSeconds: 30, compactTables: false, showAdvancedMetadata: false },
    mainnetAcknowledged: false,
    ...overrides,
  };
}

describe("account settings", () => {
  it("defaults a new wallet to a safe devnet workspace", () => {
    const settings = defaultAccountSettings(owner);
    expect(settings.environment).toBe("devnet");
    expect(settings.solanaNetwork).toBe("devnet");
    expect(settings.taskDefaults.executionMode).toBe("deterministic");
    expect(settings.mainnetAcknowledged).toBe(false);
  });

  it("rejects environment, network, and explorer drift", () => {
    expect(() => parseAccountSettings(input({ solanaNetwork: "mainnet-beta" }), owner)).toThrow(ApplicationError);
    expect(() => parseAccountSettings(input({ explorerCluster: "mainnet-beta" }), owner)).toThrow(ApplicationError);
  });

  it("requires explicit mainnet acknowledgement, mint, and a live execution mode", () => {
    expect(() => parseAccountSettings(input({ environment: "mainnet", solanaNetwork: "mainnet-beta", explorerCluster: "mainnet-beta" }), owner)).toThrow("Mainnet must be explicitly acknowledged");
    expect(() => parseAccountSettings(input({ environment: "mainnet", solanaNetwork: "mainnet-beta", explorerCluster: "mainnet-beta", mainnetAcknowledged: true }), owner)).toThrow("explicit token mint");
    expect(() => parseAccountSettings(input({ environment: "mainnet", solanaNetwork: "mainnet-beta", explorerCluster: "mainnet-beta", mainnetAcknowledged: true, defaultAssetMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", taskDefaults: { agentId: "agent", executionMode: "deterministic", saveAsDraft: false } }), owner)).toThrow("Deterministic demo execution");
  });

  it("accepts an explicitly configured mainnet workspace", () => {
    const settings = parseAccountSettings(input({
      environment: "mainnet",
      solanaNetwork: "mainnet-beta",
      explorerCluster: "mainnet-beta",
      mainnetAcknowledged: true,
      defaultAssetMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      taskDefaults: { agentId: "agent", executionMode: "x402", saveAsDraft: true },
    }), owner);
    expect(settings.environment).toBe("mainnet");
    expect(settings.defaultAssetMint).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });
});

describe("environment compatibility", () => {
  const settings = parseAccountSettings(input(), owner);

  it("rejects integrations that do not support the active network", () => {
    expect(() => assertIntegrationCompatible(settings, {
      protocol: "x402",
      endpoint: "https://provider.example/pay",
      supportedNetworks: ["mainnet-beta"],
      supportedAssets: ["USDC"],
    })).toThrow("active devnet network");
  });

  it("rejects integrations that do not support the default asset", () => {
    expect(() => assertIntegrationCompatible(settings, {
      protocol: "mpp",
      endpoint: "https://provider.example/pay",
      supportedNetworks: ["solana-devnet"],
      supportedAssets: ["SOL"],
    })).toThrow("workspace default asset USDC");
  });

  it("accepts aliases that clearly target the active Solana environment", () => {
    expect(() => assertIntegrationCompatible(settings, {
      protocol: "x402",
      endpoint: "https://provider.example/pay",
      supportedNetworks: ["solana-devnet"],
      supportedAssets: ["USDC"],
    })).not.toThrow();
  });

  it("rejects task policies that cannot run in the active workspace", () => {
    expect(() => assertTaskCompatibleWithSettings(settings, {
      mode: "x402",
      allowedNetworks: ["mainnet-beta"],
      allowedMints: ["USDC"],
      allowedProtocols: ["x402"],
    })).toThrow("does not allow the active devnet network");
  });
});
