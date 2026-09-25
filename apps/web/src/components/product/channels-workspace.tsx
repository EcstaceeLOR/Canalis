"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./channels-workspace.module.css";

type ChannelAction = "finalize" | "recover" | "inspect" | null;
type ChannelStatus = "active" | "reserved" | "sealed" | "settled" | "recovered" | "recoverable" | "expired" | "failed";
type ChannelSummary = {
  id: string; taskId: string; taskName: string; providerId: string; providerName: string; providerPayee: string; payer: string;
  mint: string; network: string; programAddress: string; channelAddress?: string; status: string; operationalStatus: ChannelStatus;
  ceilingAtomic: string; cumulativeAuthorizedAtomic: string; spentAtomic: string; remainingEscrowAtomic: string; recoverableAtomic: string;
  createdAtUnixSeconds: string; expiresAtUnixSeconds: string; updatedAtUnixSeconds: string; recoveryStage?: string; recoveryRequired: boolean;
  automaticRetryBlocked: boolean; nextAction: ChannelAction; openTransactionSignature?: string; settleTransactionSignature?: string;
  distributionTransactionSignature?: string; refundTransactionSignature?: string;
};
type ChannelList = {
  channels: ChannelSummary[]; total: number; page: number; pageSize: number; totalPages: number;
  counts: Record<ChannelStatus, number>;
};
type ChannelDetail = {
  task: { id: string; status: string; mint: string; owner: string; expiresAtUnixSeconds: string };
  channel: ChannelSummary & { recoveryState?: Record<string, unknown> };
  accounting: { ceilingAtomic: string; authorizedAtomic: string; recoverableAtomic: string; remainingEscrowAtomic: string; reconciled: boolean };
  vouchers: Array<{ id: string; requestId: string; status: string; previousCumulativeAtomic: string; nextCumulativeAtomic: string; quotedAmountAtomic: string; authorizationId?: string; paymentReference?: string; responseHash?: string; createdAtUnixSeconds: string }>;
  settlements: Array<{ providerId: string; cumulativeAmountAtomic: string; transactionSignature: string }>;
  recovery: { stage: string | null; required: boolean; automaticRetryBlocked: boolean; state: Record<string, unknown> | null };
  nextAction: ChannelAction;
};
type ProviderOption = { id: string; name: string };

const emptyCounts: ChannelList["counts"] = { active: 0, reserved: 0, sealed: 0, settled: 0, recovered: 0, recoverable: 0, expired: 0, failed: 0 };
const filters: Array<{ id: "all" | ChannelStatus; label: string }> = [
  { id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "recoverable", label: "Recoverable" },
  { id: "settled", label: "Settled" }, { id: "recovered", label: "Recovered" }, { id: "expired", label: "Expired" },
  { id: "failed", label: "Needs recovery" }, { id: "reserved", label: "Reserved" }, { id: "sealed", label: "Sealed" },
];

function atomic(value: string) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(Number(value) / 1_000_000);
}
function short(value?: string, head = 7, tail = 5) {
  if (!value) return "—";
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
function time(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(Number(value) * 1000));
}
function explorerSuffix(network: string) {
  const value = network.toLowerCase();
  if (value.includes("devnet") || value.includes("etwtrabza")) return "?cluster=devnet";
  if (value.includes("mainnet") || value.includes("5eykt4u")) return "";
  return undefined;
}
function explorerAddress(value: string, network: string) {
  const suffix = explorerSuffix(network);
  return suffix === undefined ? undefined : `https://explorer.solana.com/address/${value}${suffix}`;
}
function explorerTx(value: string, network: string) {
  const suffix = explorerSuffix(network);
  return suffix === undefined ? undefined : `https://explorer.solana.com/tx/${value}${suffix}`;
}
function networkLabel(network: string) {
  const value = network.toLowerCase();
  if (value.includes("devnet") || value.includes("etwtrabza")) return "Devnet";
  if (value.includes("mainnet") || value.includes("5eykt4u")) return "Mainnet";
  if (value.includes("local")) return "Localnet";
  return network;
}
async function responseError(response: Response) {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch { return `Request failed (${response.status}).`; }
}
function actionLabel(action: ChannelAction) {
  return action === "finalize" ? "Finalize" : action === "recover" ? "Recover unused" : action === "inspect" ? "Inspect recovery" : "Inspect";
}

export function ChannelsWorkspace() {
  const { session, status: walletStatus } = useWalletIdentity();
  const [result, setResult] = useState<ChannelList>({ channels: [], total: 0, page: 1, pageSize: 25, totalPages: 1, counts: emptyCounts });
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | ChannelStatus>("all");
  const [provider, setProvider] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyId, setBusyId] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "25", status });
    if (search.trim()) params.set("q", search.trim());
    if (provider !== "all") params.set("provider", provider);
    return params.toString();
  }, [page, provider, search, status]);

  const loadProviders = useCallback(async () => {
    if (!session) { setProviders([]); return; }
    const response = await fetch("/api/providers", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { providers: ProviderOption[] };
    setProviders(body.providers.map(({ id, name }) => ({ id, name })));
  }, [session]);

  const load = useCallback(async () => {
    if (!session) {
      setResult({ channels: [], total: 0, page: 1, pageSize: 25, totalPages: 1, counts: emptyCounts });
      return;
    }
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/channels?${query}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      setResult(await response.json() as ChannelList);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load channels.");
    } finally { setLoading(false); }
  }, [query, session]);

  useEffect(() => { void loadProviders(); }, [loadProviders]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);
  useEffect(() => setPage(1), [provider, search, status]);

  async function openChannel(channel: ChannelSummary) {
    setDetailLoading(true); setError("");
    try {
      const response = await fetch(`/api/channels/${encodeURIComponent(channel.taskId)}/${encodeURIComponent(channel.providerId)}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      setDetail(await response.json() as ChannelDetail);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load channel details."); }
    finally { setDetailLoading(false); }
  }

  async function act(channel: ChannelSummary | ChannelDetail["channel"], action: "finalize" | "recover") {
    const id = `${channel.taskId}:${channel.providerId}`;
    setBusyId(id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/channels/${encodeURIComponent(channel.taskId)}/${encodeURIComponent(channel.providerId)}/action`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice(action === "recover" ? "Unused channel escrow recovered on Solana." : "Channel finalized and reconciled on Solana.");
      setDetail(null);
      await load();
      await openChannel(channel as ChannelSummary);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Channel action failed."); }
    finally { setBusyId(""); }
  }

  if (!session) {
    return <section className={styles.connect}><span>◎</span><div><h2>Connect your wallet to manage channels</h2><p>Channel records and terminal actions are scoped to the authenticated payer wallet. {walletStatus === "loading" ? "Checking your session…" : "Use Connect wallet in the top bar to continue."}</p></div></section>;
  }

  const terminal = result.counts.settled + result.counts.recovered;
  const attention = result.counts.failed + result.counts.expired + result.counts.recoverable;

  return <div className={styles.workspace}>
    <section className={styles.metrics}>
      <Metric label="Channels" value={String(Object.values(result.counts).reduce((sum, value) => sum + value, 0))} detail="Wallet-owned records" />
      <Metric label="Active" value={String(result.counts.active)} detail="Currently open" />
      <Metric label="Terminal" value={String(terminal)} detail="Settled or recovered" />
      <Metric label="Attention" value={String(attention)} detail="Recoverable, expired, or failed" alert={attention > 0} />
    </section>

    <section className={styles.card}>
      <div className={styles.toolbar}>
        <label className={styles.search}><span>⌕</span><input aria-label="Search channels" placeholder="Search channel, task, provider…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <select aria-label="Filter channels by provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
          <option value="all">All providers</option>{providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
        <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      <div className={styles.filters} role="tablist" aria-label="Channel status filters">
        {filters.map((filter) => <button key={filter.id} type="button" role="tab" aria-selected={status === filter.id} className={status === filter.id ? styles.selected : ""} onClick={() => setStatus(filter.id)}>{filter.label}{filter.id !== "all" ? <b>{result.counts[filter.id]}</b> : <b>{result.total}</b>}</button>)}
      </div>

      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      {error ? <div className={styles.error} role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div> : null}

      {loading && result.channels.length === 0 ? <div className={styles.skeletons}>{[0,1,2,3].map((value) => <i key={value} />)}</div> : result.channels.length === 0 ? (
        <div className={styles.empty}><span>◎</span><div><h2>No channels in this view</h2><p>{status === "all" && !search ? "Create a task to reserve provider channels. Live x402 tasks become actionable here after they are opened." : "Change the search or status filters to broaden the result set."}</p></div><Link href="/tasks">Open Tasks →</Link></div>
      ) : (
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Channel</th><th>Task / provider</th><th>Status</th><th>Ceiling</th><th>Authorized</th><th>Recoverable</th><th>Network</th><th>Last activity</th><th /></tr></thead>
          <tbody>{result.channels.map((channel) => <tr key={channel.id} className={channel.recoveryRequired ? styles.attentionRow : ""}>
            <td><button className={styles.channelLink} type="button" onClick={() => void openChannel(channel)}>{short(channel.channelAddress ?? channel.id, 10, 7)}</button><small>{channel.channelAddress ? "PDA" : "Reserved · no PDA yet"}</small></td>
            <td><Link href={`/tasks/${channel.taskId}`}>{channel.taskName}</Link><small>{channel.providerName}</small></td>
            <td><Status value={channel.operationalStatus} /></td>
            <td>{atomic(channel.ceilingAtomic)}</td><td>{atomic(channel.cumulativeAuthorizedAtomic)}</td><td>{atomic(channel.recoverableAtomic)}</td>
            <td><span className={styles.network}>● {networkLabel(channel.network)}</span></td><td>{time(channel.updatedAtUnixSeconds)}</td>
            <td><div className={styles.rowActions}><button type="button" onClick={() => void openChannel(channel)}>{channel.nextAction === "inspect" ? "Inspect" : "Details"}</button>{channel.nextAction === "finalize" || channel.nextAction === "recover" ? <button type="button" className={styles.primary} disabled={busyId === channel.id} onClick={() => void act(channel, channel.nextAction as "finalize" | "recover")}>{busyId === channel.id ? "Working…" : actionLabel(channel.nextAction)}</button> : null}</div></td>
          </tr>)}</tbody></table></div>
      )}
      {result.totalPages > 1 ? <div className={styles.pagination}><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>← Previous</button><span>Page {result.page} of {result.totalPages}</span><button disabled={page >= result.totalPages} onClick={() => setPage((value) => value + 1)}>Next →</button></div> : null}
    </section>

    {(detail || detailLoading) ? <div className={styles.backdrop} onMouseDown={() => !detailLoading && setDetail(null)}><aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Channel details" onMouseDown={(event) => event.stopPropagation()}>{detailLoading && !detail ? <div className={styles.drawerLoading}>Loading channel evidence…</div> : detail ? <ChannelDrawer detail={detail} busy={busyId === `${detail.task.id}:${detail.channel.providerId}`} close={() => setDetail(null)} act={act} /> : null}</aside></div> : null}
  </div>;
}

function Metric({ label, value, detail, alert = false }: { label: string; value: string; detail: string; alert?: boolean }) {
  return <div className={`${styles.metric} ${alert ? styles.metricAlert : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
function Status({ value }: { value: ChannelStatus }) { return <span className={`${styles.status} ${styles[`status_${value}`]}`}><i />{value === "failed" ? "needs recovery" : value}</span>; }

function ChannelDrawer({ detail, busy, close, act }: { detail: ChannelDetail; busy: boolean; close: () => void; act: (channel: ChannelDetail["channel"], action: "finalize" | "recover") => Promise<void> }) {
  const { channel, task } = detail;
  const signatures = [
    ["Open", channel.openTransactionSignature], ["Settle / seal", channel.settleTransactionSignature],
    ["Distribute", channel.distributionTransactionSignature], ["Refund", channel.refundTransactionSignature],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  const channelExplorer = channel.channelAddress ? explorerAddress(channel.channelAddress, channel.network) : undefined;
  return <>
    <header className={styles.drawerHead}><div><span>Payment channel</span><h2>{channel.providerId} · {short(channel.channelAddress ?? `${task.id}:${channel.providerId}`, 12, 8)}</h2><p><span className={styles.network}>● {networkLabel(channel.network)}</span> {channel.status}</p></div><button type="button" onClick={close} aria-label="Close channel details">×</button></header>
    {detail.recovery.required ? <div className={styles.recoveryAlert}><strong>Manual reconciliation required</strong><p>Automatic rebroadcast is blocked because a prior terminal attempt may have reached Solana. Inspect the persisted retry state and Explorer evidence before any recovery intervention.</p><code>{detail.recovery.stage ?? "unknown-stage"}</code></div> : null}
    <section className={styles.detailGrid}><div><span>Channel PDA</span><strong>{channel.channelAddress ? short(channel.channelAddress, 12, 9) : "Not opened"}</strong>{channelExplorer ? <a href={channelExplorer} target="_blank" rel="noreferrer">Explorer ↗</a> : null}</div><div><span>Payer</span><strong>{short(task.owner, 12, 9)}</strong></div><div><span>Mint</span><strong>{short(task.mint, 12, 9)}</strong></div><div><span>Expires</span><strong>{time(task.expiresAtUnixSeconds)}</strong></div></section>
    <section className={styles.accounting}><div><span>Ceiling</span><strong>{atomic(detail.accounting.ceilingAtomic)}</strong></div><b>=</b><div><span>Authorized</span><strong>{atomic(detail.accounting.authorizedAtomic)}</strong></div><b>+</b><div><span>Recoverable</span><strong>{atomic(detail.accounting.recoverableAtomic)}</strong></div><small>{detail.accounting.reconciled ? "Terminal accounting reconciled" : `${atomic(detail.accounting.remainingEscrowAtomic)} unused units remain attributable to payer recovery`}</small></section>
    <section className={styles.drawerSection}><div className={styles.sectionHead}><div><span>Voucher history</span><strong>{detail.vouchers.length} authorization{detail.vouchers.length === 1 ? "" : "s"}</strong></div></div>{detail.vouchers.length ? <div className={styles.vouchers}>{detail.vouchers.map((voucher) => <div key={voucher.id}><span>{voucher.requestId}</span><strong>{atomic(voucher.previousCumulativeAtomic)} → {atomic(voucher.nextCumulativeAtomic)}</strong><small>{voucher.responseHash ? `Receipt ${short(voucher.responseHash, 10, 7)}` : voucher.status}</small></div>)}</div> : <p className={styles.muted}>No cumulative voucher has been authorized for this channel yet.</p>}</section>
    <section className={styles.drawerSection}><div className={styles.sectionHead}><div><span>On-chain evidence</span><strong>{signatures.length} transaction{signatures.length === 1 ? "" : "s"}</strong></div></div>{signatures.length ? <div className={styles.evidence}>{signatures.map(([label, signature]) => { const href = explorerTx(signature, channel.network); return href ? <a key={`${label}:${signature}`} href={href} target="_blank" rel="noreferrer"><span>{label}</span><code>{short(signature, 12, 9)}</code><b>↗</b></a> : <div key={`${label}:${signature}`}><span>{label}</span><code>{short(signature, 12, 9)}</code></div>; })}</div> : <p className={styles.muted}>No real transaction signature has been persisted for this channel.</p>}</section>
    {detail.recovery.state ? <details className={styles.retryState}><summary>Persisted recovery / retry state</summary><pre>{JSON.stringify(detail.recovery.state, null, 2)}</pre></details> : null}
    <footer className={styles.drawerFooter}><div><Link href={`/tasks/${task.id}`}>Task ↗</Link><Link href="/providers">Provider ↗</Link><Link href={`/transactions?task=${encodeURIComponent(task.id)}`}>Transactions ↗</Link></div>{detail.nextAction === "finalize" || detail.nextAction === "recover" ? <button className={styles.finalize} type="button" disabled={busy} onClick={() => void act(channel, detail.nextAction as "finalize" | "recover")}>{busy ? "Submitting terminal action…" : actionLabel(detail.nextAction)}</button> : detail.nextAction === "inspect" ? <span className={styles.blocked}>Automatic retry blocked</span> : <span className={styles.blocked}>No terminal action available</span>}</footer>
  </>;
}
