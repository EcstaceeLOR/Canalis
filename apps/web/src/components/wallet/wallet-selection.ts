type WalletCandidate = {
  name: string;
  features: Record<string, unknown>;
};

const METAMASK_WALLET_NAME = "MetaMask";

function supportsCanalisAuth(wallet: WalletCandidate) {
  return Boolean(
    wallet.features["standard:connect"] && wallet.features["solana:signMessage"],
  );
}

export function selectCompatibleWallets<T extends WalletCandidate>(
  discovered: readonly T[],
  fallbackMetaMask: T | null,
) {
  const compatible = discovered.filter(supportsCanalisAuth);
  const registeredMetaMask = compatible.find((wallet) => wallet.name === METAMASK_WALLET_NAME);
  const selectedMetaMask = registeredMetaMask ?? (
    fallbackMetaMask && supportsCanalisAuth(fallbackMetaMask) ? fallbackMetaMask : null
  );
  const otherWallets = compatible.filter((wallet) => wallet.name !== METAMASK_WALLET_NAME);

  return selectedMetaMask ? [selectedMetaMask, ...otherWallets] : otherWallets;
}
