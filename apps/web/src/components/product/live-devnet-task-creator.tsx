"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./live-devnet-task-creator.module.css";

const PROVIDERS = ["search", "data", "inference"] as const;

async function responseMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function LiveDevnetTaskCreator() {
  const router = useRouter();
  const { session } = useWalletIdentity();
  const [name, setName] = useState("Live devnet agent run");
  const [budget, setBudget] = useState("1.00");
  const [maxPerCall, setMaxPerCall] = useState("0.25");
  const [providers, setProviders] = useState<string[]>([...PROVIDERS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggle(provider: string) {
    setProviders((current) =>
      current.includes(provider)
        ? current.filter((entry) => entry !== provider)
        : [...current, provider],
    );
  }

  async function create() {
    if (!session || providers.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description: "Wallet-signed x402 upto payment channels on Solana devnet.",
          agentId: "canalis-live-agent",
          budgetUsd: budget,
          maxPerCallUsd: maxPerCall,
          expiryMinutes: 60,
          allowedProviders: providers,
          policyId: "live-devnet-bounded",
          mode: "x402",
          saveAsDraft: false,
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const created = (await response.json()) as { task: { id: string } };
      router.push(`/tasks/${created.task.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create live task.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-label="Create a live Solana devnet task">
      <div className={styles.copy}>
        <span className={styles.eyebrow}>Live Devnet Sandbox</span>
        <h2>Run the real payment-channel lifecycle from your wallet.</h2>
        <p>
          Canalis funds a bounded test-token balance, your connected wallet signs each real
          Solana devnet channel open, and the server settles only the cumulative spend produced
          by task policy. No seed phrase or private key is sent to Canalis.
        </p>
        <div className={styles.facts}>
          <span>Real devnet transactions</span><span>x402 upto</span><span>5 test-USDC maximum</span><span>Not mainnet funds</span>
        </div>
      </div>
      <div className={styles.form}>
        <label>Task name<input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
        <div className={styles.row}>
          <label>Budget (test USDC)<input inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} /></label>
          <label>Max / call<input inputMode="decimal" value={maxPerCall} onChange={(event) => setMaxPerCall(event.target.value)} /></label>
        </div>
        <label>Providers<div className={styles.providers}>{PROVIDERS.map((provider) => <button type="button" key={provider} data-active={providers.includes(provider)} onClick={() => toggle(provider)}>{provider}</button>)}</div></label>
        <button className={styles.submit} type="button" disabled={!session || busy || !name.trim() || providers.length === 0} onClick={() => void create()}>{busy ? "Creating…" : session ? "Create live task →" : "Connect wallet to create"}</button>
        <span className={styles.message}>The built-in sandbox is hard-locked to Solana devnet and uses a test mint controlled by the public Canalis devnet sponsor.</span>
        {error ? <span className={styles.error} role="alert">{error}</span> : null}
      </div>
    </section>
  );
}
