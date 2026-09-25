"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import { solanaExplorerAddressUrl, solanaExplorerTxUrl } from "./task-detail-model";
import styles from "./transaction-detail.module.css";

type EventType = "authorization" | "receipt" | "channel_open" | "settlement" | "distribution" | "recovery" | "failure";
type Layer = "offchain" | "onchain";

type TransactionEvent = {
  id: string;
  taskId: string;
  taskName: string;
  providerId: string;
  providerName: string;
  eventType: EventType;
  layer: Layer;
  status: string;
  protocol: string;
  network: string;
  mint: string;
  amountAtomic: string;
  cumulativeAtomic?: string;
  authorizedDeltaAtomic: string;
  settledDeltaAtomic: string;
  recoveredAtomic: string;
  channelAddress?: string;
  receiptHash?: string;
  signature?: string;
  requestId?: string;
  authorizationId?: string;
  paymentReference?: string;
  sourceFlowId?: string;
  metadata: Record<string, unknown>;
  createdAtUnixSeconds: string;
};

function usd(atomic: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(Number(atomic) / 1_000_000);
}

function when(unix: string) {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(Number(unix) * 1000));
}

function typeLabel(type: EventType) {
  const labels: Record<EventType, string> = {
    authorization: "Payment authorization",
    receipt: "Provider receipt",
    channel_open: "Channel open",
    settlement: "Settlement",
    distribution: "Provider distribution",
    recovery: "Payer recovery",
    failure: "Operational failure",
  };
  return labels[type];
}

function eventSummary(event: TransactionEvent) {
  if (event.eventType === "authorization") return `${usd(event.amountAtomic)} authorized for ${event.providerName}`;
  if (event.eventType === "receipt") return `${usd(event.amountAtomic)} receipt proof from ${event.providerName}`;
  if (event.eventType === "channel_open") return `${usd(event.amountAtomic)} channel ceiling opened`;
  if (event.eventType === "settlement") return `${usd(event.amountAtomic)} cumulative settlement`;
  if (event.eventType === "distribution") return `${usd(event.amountAtomic)} distributed to provider`;
  if (event.eventType === "recovery") return `${usd(event.recoveredAtomic)} recovered to payer`;
  return "Failure recorded without changing accounting totals";
}

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function TransactionDetail({ eventId }: { eventId: string }) {
  const { session, status: walletStatus } = useWalletIdentity();
  const [event, setEvent] = useState<TransactionEvent | null>(null);
  const [related, setRelated] = useState<TransactionEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(eventId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = (await response.json()) as { event: TransactionEvent; related: TransactionEvent[] };
      setEvent(body.event);
      setRelated(body.related);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load transaction event.");
    } finally {
      setLoading(false);
    }
  }, [eventId, session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) {
    return <section className={styles.state}><div><h2>Connect your wallet to inspect this event</h2><p>{walletStatus === "loading" ? "Checking your existing session…" : "Audit records are visible only to the wallet that owns the underlying task."}</p></div></section>;
  }

  if (loading && !event) return <section className={styles.state}><div><h2>Loading audit event…</h2><p>Reading the persisted transaction ledger.</p></div></section>;
  if (error) return <section className={styles.state}><div><h2>Could not load this event</h2><p>{error}</p><button type="button" onClick={() => void load()}>Retry</button></div></section>;
  if (!event) return null;

  const txUrl = solanaExplorerTxUrl(event.signature, event.network);
  const channelUrl = solanaExplorerAddressUrl(event.channelAddress, event.network);

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/transactions">← Back to transactions & receipts</Link>
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <div><span className={styles.eyebrow}>Audit event</span><h1>{typeLabel(event.eventType)}</h1><p>{eventSummary(event)} · {when(event.createdAtUnixSeconds)}</p></div>
          <div className={styles.badges}><span className={styles.badge} data-layer={event.layer}>{event.layer === "onchain" ? "On-chain" : "Off-chain"}</span><span className={styles.badge} data-status={event.status}>{event.status}</span><span className={styles.badge}>{event.protocol.toUpperCase()}</span></div>
        </div>
        <div className={styles.metrics}>
          <div><span>Event amount</span><strong>{usd(event.amountAtomic)}</strong></div>
          <div><span>Authorized delta</span><strong>{usd(event.authorizedDeltaAtomic)}</strong></div>
          <div><span>Settled delta</span><strong>{usd(event.settledDeltaAtomic)}</strong></div>
          <div><span>Recovered</span><strong>{usd(event.recoveredAtomic)}</strong></div>
        </div>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>Traceability</h2>
          <dl className={styles.facts}>
            <div className={styles.fact}><dt>Task</dt><dd><Link href={`/tasks/${event.taskId}`}>{event.taskName}</Link><br/><span className={styles.mono}>{event.taskId}</span></dd></div>
            <div className={styles.fact}><dt>Provider</dt><dd><Link href={`/providers?provider=${encodeURIComponent(event.providerId)}`}>{event.providerName}</Link><br/><span className={styles.mono}>{event.providerId}</span></dd></div>
            <div className={styles.fact}><dt>Protocol</dt><dd>{event.protocol.toUpperCase()}</dd></div>
            <div className={styles.fact}><dt>Network</dt><dd className={styles.mono}>{event.network}</dd></div>
            <div className={styles.fact}><dt>Mint / asset</dt><dd className={styles.mono}>{event.mint}</dd></div>
            <div className={styles.fact}><dt>Cumulative authorization</dt><dd>{event.cumulativeAtomic ? usd(event.cumulativeAtomic) : "—"}</dd></div>
            <div className={styles.fact}><dt>Request ID</dt><dd className={styles.mono}>{event.requestId ?? "—"}</dd></div>
            <div className={styles.fact}><dt>Authorization ID</dt><dd className={styles.mono}>{event.authorizationId ?? "—"}</dd></div>
            <div className={styles.fact}><dt>Payment reference</dt><dd className={styles.mono}>{event.paymentReference ?? "—"}</dd></div>
            <div className={styles.fact}><dt>Source flow</dt><dd className={styles.mono}>{event.sourceFlowId ?? "—"}</dd></div>
            <div className={styles.fact}><dt>Receipt hash</dt><dd className={styles.mono}>{event.receiptHash ?? "—"}</dd></div>
            <div className={styles.fact}><dt>Event ID</dt><dd className={styles.mono}>{event.id}</dd></div>
          </dl>
          {event.signature && txUrl ? <a className={styles.explorer} href={txUrl} target="_blank" rel="noreferrer">Open transaction on Solana Explorer ↗</a> : null}
          {event.channelAddress && channelUrl ? <a className={styles.explorer} href={channelUrl} target="_blank" rel="noreferrer">Open channel address on Solana Explorer ↗</a> : event.channelAddress ? <Link className={styles.explorer} href={`/channels?q=${encodeURIComponent(event.channelAddress)}`}>Open channel in Canalis →</Link> : null}
        </article>

        <article className={styles.card}>
          <h2>Provider route timeline</h2>
          <div className={styles.timeline}>{related.map((item) => <div className={styles.timelineItem} data-active={item.id === event.id} key={item.id}><span className={styles.dot}/><div className={styles.timelineBody}><Link href={`/transactions/${encodeURIComponent(item.id)}`}>{typeLabel(item.eventType)}</Link><small>{when(item.createdAtUnixSeconds)} · {item.layer} · {item.status}</small><p>{eventSummary(item)}</p></div></div>)}</div>
        </article>
      </section>

      <article className={styles.card}>
        <h2>Normalized metadata</h2>
        <pre className={styles.raw}>{JSON.stringify({
          id: event.id,
          eventType: event.eventType,
          layer: event.layer,
          status: event.status,
          protocol: event.protocol,
          network: event.network,
          taskId: event.taskId,
          providerId: event.providerId,
          channelAddress: event.channelAddress ?? null,
          receiptHash: event.receiptHash ?? null,
          signature: event.signature ?? null,
          amountAtomic: event.amountAtomic,
          cumulativeAtomic: event.cumulativeAtomic ?? null,
          authorizedDeltaAtomic: event.authorizedDeltaAtomic,
          settledDeltaAtomic: event.settledDeltaAtomic,
          recoveredAtomic: event.recoveredAtomic,
          requestId: event.requestId ?? null,
          authorizationId: event.authorizationId ?? null,
          paymentReference: event.paymentReference ?? null,
          sourceFlowId: event.sourceFlowId ?? null,
          metadata: event.metadata,
          createdAtUnixSeconds: event.createdAtUnixSeconds,
        }, null, 2)}</pre>
      </article>
    </div>
  );
}
