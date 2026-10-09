import { describe, expect, it } from "vitest";
import { selectCompatibleWallets } from "./wallet-selection";

function wallet(name: string, compatible = true) {
  return {
    name,
    icon: `data:image/svg+xml,${name}`,
    chains: ["solana:devnet"],
    accounts: [],
    features: compatible
      ? {
          "standard:connect": { connect: async () => ({ accounts: [] }) },
          "solana:signMessage": { signMessage: async () => [] },
        }
      : {},
  };
}

describe("selectCompatibleWallets", () => {
  it("prefers the registered MetaMask extension over the SDK fallback", () => {
    const injectedMetaMask = wallet("MetaMask");
    const fallbackMetaMask = wallet("MetaMask");
    const phantom = wallet("Phantom");

    expect(selectCompatibleWallets([phantom, injectedMetaMask], fallbackMetaMask)).toEqual([
      injectedMetaMask,
      phantom,
    ]);
  });

  it("uses the SDK fallback when no registered MetaMask wallet exists", () => {
    const fallbackMetaMask = wallet("MetaMask");
    const solflare = wallet("Solflare");

    expect(selectCompatibleWallets([solflare], fallbackMetaMask)).toEqual([
      fallbackMetaMask,
      solflare,
    ]);
  });

  it("excludes wallets that cannot connect and sign messages", () => {
    const incompatibleMetaMask = wallet("MetaMask", false);
    const incompatibleWallet = wallet("Legacy Wallet", false);

    expect(selectCompatibleWallets([incompatibleMetaMask, incompatibleWallet], null)).toEqual([]);
  });
});
