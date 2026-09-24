"use client";

import { getWallets } from "@wallet-standard/app";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type WalletAccountLike = {
  address: string;
  publicKey: Uint8Array;
  chains: readonly string[];
  features: readonly string[];
};

type WalletLike = {
  name: string;
  icon: string;
  chains: readonly string[];
  accounts: readonly WalletAccountLike[];
  features: Record<string, unknown>;
};

type ConnectFeature = {
  connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccountLike[] }>;
};

type DisconnectFeature = { disconnect(): Promise<void> };
type SignMessageFeature = {
  signMessage(...inputs: Array<{ account: WalletAccountLike; message: Uint8Array }>): Promise<
    readonly { signedMessage: Uint8Array; signature: Uint8Array }[]
  >;
};
type EventsFeature = {
  on(
    event: "change",
    listener: (change: { accounts?: readonly WalletAccountLike[] }) => void,
  ): () => void;
};

type SessionIdentity = {
  walletAddress: string;
  network: string;
  expiresAtUnixSeconds: string;
};

type WalletStatus =
  | "loading"
  | "disconnected"
  | "connecting"
  | "signing"
  | "connected"
  | "wrong-network"
  | "error";

type WalletIdentityContextValue = {
  wallets: readonly WalletLike[];
  session: SessionIdentity | null;
  status: WalletStatus;
  error: string;
  activeWalletName?: string;
  connectWallet(wallet: WalletLike): Promise<void>;
  disconnect(): Promise<void>;
  refreshWallets(): void;
};

const WalletIdentityContext = createContext<WalletIdentityContextValue | null>(null);
const REMEMBERED_WALLET_KEY = "canalis.wallet.standard.name";
const DEVNET_CHAIN = "solana:devnet";

function feature<T>(wallet: WalletLike, name: string): T | undefined {
  return wallet.features[name] as T | undefined;
}

function supportsCanalisAuth(wallet: WalletLike) {
  return Boolean(
    feature<ConnectFeature>(wallet, "standard:connect") &&
      feature<SignMessageFeature>(wallet, "solana:signMessage"),
  );
}

function supportsDevnet(wallet: WalletLike, account: WalletAccountLike) {
  const chains = account.chains.length > 0 ? account.chains : wallet.chains;
  return chains.length === 0 || chains.includes(DEVNET_CHAIN);
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function compactAddress(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function WalletIdentityProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<readonly WalletLike[]>([]);
  const [session, setSession] = useState<SessionIdentity | null>(null);
  const [status, setStatus] = useState<WalletStatus>("loading");
  const [error, setError] = useState("");
  const [activeWallet, setActiveWallet] = useState<WalletLike | null>(null);
  const [activeAccount, setActiveAccount] = useState<WalletAccountLike | null>(null);
  const silentAttempted = useRef(false);

  const refreshWallets = useCallback(() => {
    const discovered = getWallets().get() as unknown as readonly WalletLike[];
    setWallets(discovered.filter(supportsCanalisAuth));
  }, []);

  const clearServerSession = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
    setSession(null);
  }, []);

  useEffect(() => {
    const registry = getWallets();
    refreshWallets();
    const refresh = () => refreshWallets();
    const offRegister = registry.on("register", refresh);
    const offUnregister = registry.on("unregister", refresh);

    void (async () => {
      try {
        const response = await fetch("/api/auth/session", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.ok) {
          const identity = (await response.json()) as SessionIdentity & { authenticated: true };
          setSession(identity);
          setStatus("connected");
        } else {
          setStatus("disconnected");
        }
      } catch {
        setStatus("disconnected");
      }
    })();

    return () => {
      offRegister();
      offUnregister();
    };
  }, [refreshWallets]);

  useEffect(() => {
    if (!session || activeWallet || wallets.length === 0 || silentAttempted.current) return;
    silentAttempted.current = true;
    const remembered = window.localStorage.getItem(REMEMBERED_WALLET_KEY);
    if (!remembered) return;
    const wallet = wallets.find((candidate) => candidate.name === remembered);
    const connect = wallet ? feature<ConnectFeature>(wallet, "standard:connect") : undefined;
    if (!wallet || !connect) return;

    void connect.connect({ silent: true }).then(async ({ accounts }) => {
      const account = accounts[0];
      if (!account) return;
      if (account.address !== session.walletAddress) {
        await clearServerSession();
        setActiveWallet(wallet);
        setActiveAccount(account);
        setStatus("disconnected");
        setError("Your wallet account changed. Sign the new account to continue.");
        return;
      }
      setActiveWallet(wallet);
      setActiveAccount(account);
      setStatus(supportsDevnet(wallet, account) ? "connected" : "wrong-network");
    }).catch(() => undefined);
  }, [activeWallet, clearServerSession, session, wallets]);

  useEffect(() => {
    if (!activeWallet || !activeAccount || !session) return;
    const events = feature<EventsFeature>(activeWallet, "standard:events");
    if (!events) return;
    return events.on("change", ({ accounts }) => {
      if (!accounts) return;
      const next = accounts[0];
      if (!next || next.address !== session.walletAddress) {
        void clearServerSession();
        setActiveAccount(next ?? null);
        setStatus("disconnected");
        setError("Wallet account changed. Sign in again so Canalis can re-scope your workspace.");
      }
    });
  }, [activeAccount, activeWallet, clearServerSession, session]);

  const connectWallet = useCallback(async (wallet: WalletLike) => {
    const connect = feature<ConnectFeature>(wallet, "standard:connect");
    const signMessage = feature<SignMessageFeature>(wallet, "solana:signMessage");
    if (!connect || !signMessage) {
      setStatus("error");
      setError("This wallet does not support the Wallet Standard features Canalis requires.");
      return;
    }

    setError("");
    setStatus("connecting");
    try {
      if (session) await clearServerSession();
      const { accounts } = await connect.connect();
      const account = accounts[0];
      if (!account) throw new Error("The wallet did not return a Solana account.");
      setActiveWallet(wallet);
      setActiveAccount(account);
      window.localStorage.setItem(REMEMBERED_WALLET_KEY, wallet.name);

      if (!supportsDevnet(wallet, account)) {
        setStatus("wrong-network");
        setError("This account does not advertise Solana devnet. Switch to a devnet-capable account and reconnect.");
        return;
      }

      setStatus("signing");
      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: account.address }),
      });
      if (!challengeResponse.ok) {
        throw new Error(await responseMessage(challengeResponse, "Could not create a wallet challenge."));
      }
      const challenge = (await challengeResponse.json()) as {
        challengeId: string;
        message: string;
      };
      const message = new TextEncoder().encode(challenge.message);
      const [signed] = await signMessage.signMessage({ account, message });
      if (!signed || !sameBytes(signed.signedMessage, message)) {
        throw new Error("The wallet did not sign the exact Canalis authentication message.");
      }

      const sessionResponse = await fetch("/api/auth/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          walletAddress: account.address,
          signatureBase64: toBase64(signed.signature),
        }),
      });
      if (!sessionResponse.ok) {
        throw new Error(await responseMessage(sessionResponse, "Wallet signature could not be verified."));
      }
      const identity = (await sessionResponse.json()) as SessionIdentity & { authenticated: true };
      setSession(identity);
      setStatus("connected");
      setError("");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Wallet sign-in failed.");
    }
  }, [clearServerSession, session]);

  const disconnect = useCallback(async () => {
    setError("");
    await clearServerSession();
    const disconnectFeature = activeWallet
      ? feature<DisconnectFeature>(activeWallet, "standard:disconnect")
      : undefined;
    if (disconnectFeature) await disconnectFeature.disconnect().catch(() => undefined);
    window.localStorage.removeItem(REMEMBERED_WALLET_KEY);
    setActiveWallet(null);
    setActiveAccount(null);
    silentAttempted.current = false;
    setStatus("disconnected");
  }, [activeWallet, clearServerSession]);

  const value = useMemo<WalletIdentityContextValue>(() => ({
    wallets,
    session,
    status,
    error,
    ...(activeWallet ? { activeWalletName: activeWallet.name } : {}),
    connectWallet,
    disconnect,
    refreshWallets,
  }), [activeWallet, connectWallet, disconnect, error, refreshWallets, session, status, wallets]);

  return <WalletIdentityContext.Provider value={value}>{children}</WalletIdentityContext.Provider>;
}

export function useWalletIdentity() {
  const value = useContext(WalletIdentityContext);
  if (!value) throw new Error("useWalletIdentity must be used inside WalletIdentityProvider");
  return value;
}

export function WalletAccountControl() {
  const { wallets, session, status, error, activeWalletName, connectWallet, disconnect, refreshWallets } = useWalletIdentity();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  useEffect(() => {
    if (status === "connected") setSelectorOpen(false);
  }, [status]);

  async function copyAddress() {
    if (session?.walletAddress) await navigator.clipboard.writeText(session.walletAddress);
  }

  if (session && status === "connected") {
    return (
      <div className="wallet-account-control">
        <button className="wallet-account-button" type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen}>
          <span className="wallet-live-dot" />
          <span>{compactAddress(session.walletAddress)}</span>
          <i>⌄</i>
        </button>
        {menuOpen ? (
          <div className="wallet-account-menu">
            <div className="wallet-account-summary">
              <span>Authenticated wallet</span>
              <strong>{compactAddress(session.walletAddress)}</strong>
              <small>{activeWalletName ?? "Wallet Standard session"} · Devnet</small>
            </div>
            <button type="button" onClick={copyAddress}>Copy address <span>⌘</span></button>
            <a href={`https://explorer.solana.com/address/${session.walletAddress}?cluster=devnet`} target="_blank" rel="noreferrer">Open in Explorer <span>↗</span></a>
            <button className="wallet-disconnect" type="button" onClick={() => void disconnect()}>Disconnect <span>×</span></button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wallet-account-control">
      <button
        className={`wallet-connect-button ${status === "wrong-network" ? "warning" : ""}`}
        type="button"
        onClick={() => { refreshWallets(); setSelectorOpen(true); }}
        disabled={status === "connecting" || status === "signing" || status === "loading"}
      >
        {status === "loading" ? "Checking session…" : status === "connecting" ? "Connecting…" : status === "signing" ? "Sign message…" : status === "wrong-network" ? "Wrong network" : "Connect wallet"}
      </button>
      {selectorOpen ? (
        <div className="wallet-modal-backdrop" role="presentation" onMouseDown={() => setSelectorOpen(false)}>
          <div className="wallet-modal" role="dialog" aria-modal="true" aria-label="Connect a Solana wallet" onMouseDown={(event) => event.stopPropagation()}>
            <div className="wallet-modal-head"><div><span>Wallet identity</span><h2>Connect to Canalis</h2></div><button type="button" onClick={() => setSelectorOpen(false)} aria-label="Close wallet selector">×</button></div>
            <p className="wallet-modal-copy">Canalis asks for one off-chain signature to prove wallet ownership. The message cannot submit a transaction or move funds.</p>
            <div className="wallet-list">
              {wallets.map((wallet) => (
                <button type="button" key={wallet.name} onClick={() => void connectWallet(wallet)}>
                  <img src={wallet.icon} alt="" />
                  <span><strong>{wallet.name}</strong><small>Wallet Standard · signMessage</small></span>
                  <i>→</i>
                </button>
              ))}
              {wallets.length === 0 ? (
                <div className="wallet-empty-state">
                  <strong>No compatible Solana wallet detected</strong>
                  <p>{isMobile ? "Open Canalis inside a Wallet Standard-compatible Solana wallet browser, then refresh this list." : "Install or enable a Wallet Standard-compatible Solana wallet, then refresh this list."}</p>
                  <button type="button" onClick={refreshWallets}>Refresh wallet list</button>
                </div>
              ) : null}
            </div>
            {error ? <div className="wallet-auth-error" role="alert">{error}</div> : null}
            <div className="wallet-security-note"><span>✓</span><p>Canalis stores only your public wallet address and a hashed session token. Seed phrases and private keys never leave your wallet.</p></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
