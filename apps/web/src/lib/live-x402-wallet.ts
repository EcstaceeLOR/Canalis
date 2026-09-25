import { getWallets } from "@wallet-standard/app";
import {
  address as toAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  type SignatureDictionary,
  type TransactionSigner,
} from "@solana/kit";
import { x402Client } from "@x402/core/client";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import { UptoSvmScheme } from "@x402/svm/upto/client";

type WalletAccountLike = {
  address: string;
  chains: readonly string[];
};

type ConnectFeature = {
  connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccountLike[] }>;
};

type SignTransactionFeature = {
  signTransaction(
    ...inputs: Array<{
      account: WalletAccountLike;
      transaction: Uint8Array;
      chain: "solana:devnet";
    }>
  ): Promise<readonly { signedTransaction: Uint8Array }[]>;
};

type WalletLike = {
  name: string;
  accounts: readonly WalletAccountLike[];
  features: Record<string, unknown>;
};

const REMEMBERED_WALLET_KEY = "canalis.wallet.standard.name";
const DEVNET_CHAIN = "solana:devnet" as const;

function feature<T>(wallet: WalletLike, name: string): T | undefined {
  return wallet.features[name] as T | undefined;
}

async function resolveWalletAccount(walletAddress: string) {
  const wallets = getWallets().get() as unknown as readonly WalletLike[];
  const remembered = window.localStorage.getItem(REMEMBERED_WALLET_KEY);
  const ordered = [...wallets].sort((left, right) =>
    left.name === remembered ? -1 : right.name === remembered ? 1 : 0,
  );

  for (const wallet of ordered) {
    let account = wallet.accounts.find((entry) => entry.address === walletAddress);
    if (!account && wallet.name === remembered) {
      const connect = feature<ConnectFeature>(wallet, "standard:connect");
      if (connect) {
        try {
          const result = await connect.connect({ silent: true });
          account = result.accounts.find((entry) => entry.address === walletAddress);
        } catch {
          // The identity session remains valid, but this browser wallet is not currently unlocked.
        }
      }
    }
    const signTransaction = feature<SignTransactionFeature>(wallet, "solana:signTransaction");
    if (account && signTransaction) return { wallet, account, signTransaction };
  }

  throw new Error(
    "Reconnect the authenticated wallet with transaction signing enabled before opening a live channel.",
  );
}

function walletTransactionSigner(
  walletAddress: string,
  account: WalletAccountLike,
  signFeature: SignTransactionFeature,
): TransactionSigner<string> {
  const signerAddress = toAddress(walletAddress);
  const encoder = getTransactionEncoder();
  const decoder = getTransactionDecoder();

  return {
    address: signerAddress,
    async signTransactions(transactions) {
      const signatures: SignatureDictionary[] = [];
      for (const transaction of transactions) {
        const serialized = new Uint8Array(encoder.encode(transaction));
        const [signed] = await signFeature.signTransaction({
          account,
          transaction: serialized,
          chain: DEVNET_CHAIN,
        });
        if (!signed) throw new Error("Wallet did not return a signed Solana transaction.");
        const decoded = decoder.decode(new Uint8Array(signed.signedTransaction));
        const signature = decoded.signatures[signerAddress];
        if (!signature) throw new Error("Wallet did not sign the authenticated payer account.");
        signatures.push(Object.freeze({ [signerAddress]: signature }) as SignatureDictionary);
      }
      return signatures;
    },
  };
}

export async function createLiveX402PaymentPayload(
  walletAddress: string,
  paymentRequired: PaymentRequired,
): Promise<PaymentPayload> {
  const accepted = paymentRequired.accepts[0];
  if (!accepted || accepted.scheme !== "upto" || !accepted.network.startsWith("solana:")) {
    throw new Error("Canalis expected a Solana x402 upto payment requirement.");
  }
  const { account, signTransaction } = await resolveWalletAccount(walletAddress);
  const signer = walletTransactionSigner(walletAddress, account, signTransaction);
  const client = new x402Client();
  client.setSpendControls({
    allowedAssets: [
      {
        network: accepted.network,
        asset: accepted.asset,
        maxAmountPerPayment: accepted.amount,
      },
    ],
  });
  client.register("solana:*" as never, new UptoSvmScheme(signer, {
    rpcUrl: "https://api.devnet.solana.com",
  }));
  return client.createPaymentPayload(paymentRequired);
}
