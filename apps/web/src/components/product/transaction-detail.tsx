"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./transaction-detail.module.css";

type RecordDetail = {
  id: string;
  kind: string;
  plane: "offchain" | "onchain";
  status: string;
  taskId: string;
  taskName: string;
  providerId: string;
  providerName: string;
  protocol: string;
  network?: string;
  mint?: string;
  amountAtomic: string;
  previousCumulativeAtomic?: string;
  cumulativeAtomic?: string;
  requestId?: string;
  authorizationId?: string;
  paymentReference?: string;
  responseHash?: string;
  channelAddress?: string;
  signature?: string;
  timestampUnixSeconds: string;
  rawMetadata: Record<string, unknown>;
};

function usd(value?: string) {
  return value ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(value) / 1_000_000) : "—";
}

function explorer(signature?: string, network?: string) {
  if (!signature) return undefined;
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${network?.toLowerCase().includes("mainnet") ? "" : "?cluster=devnet"}`;
}

export function TransactionDetail({ eventId }: { eventId: string }) {
  const { session, status } = useWalletIdentity();
  const [record, setRecord] = useState<RecordDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(eventId)}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `Request failed (${response.status}).`);
      }
      const body = (await response.json()) as { record: RecordDetail };
      setRecord(body.record);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load audit record.");
    } finally {
      setLoading(false);
    }
  }, [eventId, session]);

  useEffect(() => { void load(); }, [load]);

  if (!session) return <section className={styles.state}><h2>Connect your wallet</h2><p>{status === "loading" ? "Checking your session…" : "This audit record is available only to the wallet that owns its task."}</p></section>;
  if (loading && !record) return <section className={styles.state}><h2>Loading audit record…</h2></section>;
  if (error) return <section className={styles.state}><h2>Could not load record</h2><p>{error}</p><button onClick={() => void load()}>Retry</button></section>;
  if (!record) return null;

  const explorerUrl = explorer(record.signature, record.network);
  return <div className={styles.workspace}>
    <section className={styles.hero}>
      <div><span data-plane={record.plane}>{record.plane === "onchain" ? "On-chain" : "Off-chain"}</span><h2>{record.kind.replaceAll("_", " ")}</h2><p>{record.id}</p></div>
      <div><small>Amount</small><strong>{usd(record.amountAtomic)}</strong><em>{record.status}</em></div>
    </section>

    <section className={styles.grid}>
      <article><span>Task</span><Link href={`/tasks/${record.taskId}`}>{record.taskName}</Link><code>{record.taskId}</code></article>
      <article><span>Provider</span><strong>{record.providerName}</strong><code>{record.providerId}</code></article>
      <article><span>Protocol / network</span><strong>{record.protocol.toUpperCase()}</strong><code>{record.network ?? "application"}</code></article>
      <article><span>Timestamp</span><strong>{new Date(Number(record.timestampUnixSeconds) * 1000).toLocaleString()}</strong><code>{record.timestampUnixSeconds}</code></article>
      <article><span>Previous cumulative</span><strong>{usd(record.previousCumulativeAtomic)}</strong><code>{record.previousCumulativeAtomic ?? "—"}</code></article>
      <article><span>Next cumulative</span><strong>{usd(record.cumulativeAtomic)}</strong><code>{record.cumulativeAtomic ?? "—"}</code></article>
    </section>

    <section className={styles.proof}>
      <h3>{record.plane === "onchain" ? "Blockchain proof" : "Receipt proof"}</h3>
      <dl>
        <div><dt>Request ID</dt><dd>{record.requestId ?? "—"}</dd></div>
        <div><dt>Authorization ID</dt><dd>{record.authorizationId ?? "—"}</dd></div>
        <div><dt>Payment reference</dt><dd>{record.paymentReference ?? "—"}</dd></div>
        <div><dt>Response hash</dt><dd>{record.responseHash ?? "—"}</dd></div>
        <div><dt>Channel address</dt><dd>{record.channelAddress ?? "—"}</dd></div>
        <div><dt>Signature</dt><dd>{explorerUrl ? <a href={explorerUrl} target="_blank" rel="noreferrer">{record.signature} ↗</a> : record.signature ?? "—"}</dd></div>
      </dl>
    </section>

    <section className={styles.raw}><div><h3>Normalized metadata</h3><p>The persisted protocol/application metadata used to reconstruct this audit record.</p></div><pre>{JSON.stringify(record.rawMetadata, null, 2)}</pre></section>
  </div>;
}
