"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./transactions-workspace.module.css";

type TransactionRecord = {
  id: string;
  kind: "authorization" | "rejection" | "failure" | "channel_open" | "settlement" | "distribution" | "recovery";
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
  responseHash?: string;
  signature?: string;
  timestampUnixSeconds: string;
};
type Summary = { authorizationCount: number; authorizationAtomic: string; settledAtomic: string; recoveredAtomic: string; failedCount: number; onchainCount: number };
type Result = { records: TransactionRecord[]; summary: Summary; total: number; page: number; pageSize: number; totalPages: number };
type Provider = { id: string; name: string };
type Task = { id: string; name: string };

const emptyResult: Result = { records: [], summary: { authorizationCount: 0, authorizationAtomic: "0", settledAtomic: "0", recoveredAtomic: "0", failedCount: 0, onchainCount: 0 }, total: 0, page: 1, pageSize: 25, totalPages: 1 };

function usd(atomic: string) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(atomic) / 1_000_000); }
function when(unix: string) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(Number(unix) * 1000)); }
function short(value?: string, head = 8, tail = 6) { if (!value) return "—"; return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`; }
function explorer(signature?: string, network?: string) { if (!signature) return undefined; const cluster = network?.toLowerCase().includes("mainnet") ? "" : "?cluster=devnet"; return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${cluster}`; }
async function responseError(response: Response) { try { const body = (await response.json()) as { error?: { message?: string } }; return body.error?.message ?? `Request failed (${response.status}).`; } catch { return `Request failed (${response.status}).`; } }
function kindLabel(kind: TransactionRecord["kind"]) { return kind === "channel_open" ? "Channel open" : kind[0].toUpperCase() + kind.slice(1); }

export function TransactionsWorkspace() {
  const { session, status: walletStatus } = useWalletIdentity();
  const [result, setResult] = useState<Result>(emptyResult);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [provider, setProvider] = useState("all");
  const [task, setTask] = useState("all");
  const [protocol, setProtocol] = useState("all");
  const [network, setNetwork] = useState("all");
  const [status, setStatus] = useState("all");
  const [range, setRange] = useState("all");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const validKind = params.get("kind");
    if (validKind) setKind(validKind);
    const providerParam = params.get("provider"); if (providerParam) setProvider(providerParam);
    const taskParam = params.get("task"); if (taskParam) setTask(taskParam);
    const protocolParam = params.get("protocol"); if (protocolParam) setProtocol(protocolParam);
    const networkParam = params.get("network"); if (networkParam) setNetwork(networkParam);
    const statusParam = params.get("status"); if (statusParam) setStatus(statusParam);
    const fromParam = params.get("from"); const toParam = params.get("to");
    if (fromParam || toParam) { setRange("custom"); setRangeFrom(fromParam ?? ""); setRangeTo(toParam ?? ""); }
    setInitialized(true);
  }, []);

  const queryString = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: "25", sort });
    if (search.trim()) query.set("q", search.trim());
    if (kind !== "all") query.set("kind", kind);
    if (provider !== "all") query.set("provider", provider);
    if (task !== "all") query.set("task", task);
    if (protocol !== "all") query.set("protocol", protocol);
    if (network !== "all") query.set("network", network);
    if (status !== "all") query.set("status", status);
    if (range === "custom") {
      if (rangeFrom) query.set("from", rangeFrom);
      if (rangeTo) query.set("to", rangeTo);
    } else if (range !== "all") {
      const seconds = range === "24h" ? 86_400 : range === "7d" ? 604_800 : 2_592_000;
      query.set("from", String(Math.floor(Date.now() / 1000) - seconds));
    }
    return query.toString();
  }, [kind, network, page, protocol, provider, range, rangeFrom, rangeTo, search, sort, status, task]);

  const loadLookups = useCallback(async () => {
    if (!session) return;
    const [providerResponse, taskResponse] = await Promise.all([
      fetch("/api/providers", { credentials: "same-origin", cache: "no-store" }),
      fetch("/api/tasks?page=1&pageSize=100&sort=updated_desc", { credentials: "same-origin", cache: "no-store" }),
    ]);
    if (providerResponse.ok) setProviders(((await providerResponse.json()) as { providers: Provider[] }).providers);
    if (taskResponse.ok) setTasks(((await taskResponse.json()) as { tasks: Task[] }).tasks);
  }, [session]);

  const load = useCallback(async () => {
    if (!initialized) return;
    if (!session) { setResult(emptyResult); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/transactions?${queryString}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      setResult((await response.json()) as Result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load transaction history."); }
    finally { setLoading(false); }
  }, [initialized, queryString, session]);

  useEffect(() => { void loadLookups(); }, [loadLookups]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), search ? 220 : 0); return () => window.clearTimeout(timer); }, [load, search]);
  useEffect(() => setPage(1), [kind, network, protocol, provider, range, search, sort, status, task]);

  const networks = useMemo(() => [...new Set(result.records.map((record) => record.network).filter((value): value is string => Boolean(value)))].sort(), [result.records]);
  function exportUrl(format: "csv" | "json") { const query = new URLSearchParams(queryString); query.delete("page"); query.delete("pageSize"); query.set("format", format); return `/api/transactions/export?${query.toString()}`; }
  function selectRange(value: string) { setRange(value); if (value !== "custom") { setRangeFrom(""); setRangeTo(""); } }

  if (!session) return <section className={styles.connect}><div>≡</div><section><h2>Connect your wallet to open the audit explorer</h2><p>{walletStatus === "loading" ? "Checking your wallet session…" : "Transactions and receipts are scoped to the authenticated wallet and its tasks."}</p></section></section>;

  return <div className={styles.workspace}>
    <section className={styles.summary}>
      <div><span>Authorized</span><strong>{usd(result.summary.authorizationAtomic)}</strong><small>{result.summary.authorizationCount} paid calls</small></div>
      <div><span>Settled</span><strong>{usd(result.summary.settledAtomic)}</strong><small>on-chain settlement value</small></div>
      <div><span>Recovered</span><strong>{usd(result.summary.recoveredAtomic)}</strong><small>returned to payer</small></div>
      <div><span>Exceptions</span><strong>{result.summary.failedCount}</strong><small>rejected or failed calls</small></div>
      <div><span>On-chain proofs</span><strong>{result.summary.onchainCount}</strong><small>matching current filters</small></div>
    </section>

    <section className={styles.toolbar}>
      <div className={styles.search}><span>⌕</span><input aria-label="Search transaction history" placeholder="Task, provider, receipt hash, channel, signature…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <select aria-label="Filter event type" value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All event types</option><option value="authorization">Authorization</option><option value="channel_open">Channel open</option><option value="settlement">Settlement</option><option value="distribution">Distribution</option><option value="recovery">Recovery</option><option value="rejection">Rejected</option><option value="failure">Failed</option></select>
      <select aria-label="Filter task" value={task} onChange={(event) => setTask(event.target.value)}><option value="all">All tasks</option>{tasks.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
      <select aria-label="Filter provider" value={provider} onChange={(event) => setProvider(event.target.value)}><option value="all">All providers</option>{providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
      <select aria-label="Filter protocol" value={protocol} onChange={(event) => setProtocol(event.target.value)}><option value="all">All protocols</option><option value="demo">Deterministic</option><option value="x402">x402</option><option value="mpp">MPP</option></select>
      <select aria-label="Filter network" value={network} onChange={(event) => setNetwork(event.target.value)}><option value="all">All networks</option>{network !== "all" && !networks.includes(network) ? <option value={network}>{network}</option> : null}{networks.map((item) => <option value={item} key={item}>{item}</option>)}</select>
      <select aria-label="Filter status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="confirmed">Confirmed</option><option value="fulfilled">Fulfilled</option><option value="rejected">Rejected</option><option value="failed">Failed</option><option value="failed,rejected">Failed + rejected</option></select>
      <select aria-label="Filter date range" value={range} onChange={(event) => selectRange(event.target.value)}><option value="all">Any date</option><option value="24h">Last 24h</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>{range === "custom" ? <option value="custom">Analytics drill-down range</option> : null}</select>
      <select aria-label="Sort transactions" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="amount_desc">Largest amount</option></select>
      <div className={styles.exports}><a href={exportUrl("csv")}>Export CSV</a><a href={exportUrl("json")}>Export JSON</a></div>
    </section>

    {error ? <div className={styles.error} role="alert"><span>{error}</span><button onClick={() => void load()}>Retry</button></div> : null}
    <section className={styles.listHead}><div><strong>{result.total}</strong><span> audit records</span></div>{loading ? <span>Refreshing…</span> : range === "custom" ? <span>Analytics drill-down range applied</span> : null}</section>

    {loading && result.records.length === 0 ? <div className={styles.skeletons}>{[0,1,2,3,4].map((item) => <div key={item} />)}</div> : result.records.length === 0 ? <section className={styles.empty}><div>≡</div><section><h2>No audit records match this view</h2><p>Run a paid task or broaden the filters. Canalis only shows persisted receipts and real lifecycle evidence.</p></section></section> : <section className={styles.tableWrap}>
      <div className={styles.table}>
        <div className={styles.head}><span>Event</span><span>Amount</span><span>Task / provider</span><span>Protocol</span><span>Status</span><span>Proof</span><span>Time</span></div>
        {result.records.map((record) => {
          const explorerUrl = explorer(record.signature, record.network);
          return <div className={styles.row} key={record.id}>
            <div className={styles.event}><span className={styles.plane} data-plane={record.plane}>{record.plane === "onchain" ? "ON" : "OFF"}</span><div><strong>{kindLabel(record.kind)}</strong><small>{record.kind === "authorization" ? `receipt ${short(record.responseHash)}` : record.id}</small></div></div>
            <strong>{usd(record.amountAtomic)}</strong>
            <div><Link href={`/tasks/${record.taskId}`}>{record.taskName}</Link><small>{record.providerName}</small></div>
            <div><span>{record.protocol.toUpperCase()}</span><small>{record.network ?? "application"}</small></div>
            <span className={styles.status} data-status={record.status}>{record.status}</span>
            <div>{explorerUrl ? <a href={explorerUrl} target="_blank" rel="noreferrer">{short(record.signature)} ↗</a> : record.responseHash ? <code>{short(record.responseHash)}</code> : <span>—</span>}</div>
            <div><span>{when(record.timestampUnixSeconds)}</span><Link className={styles.details} href={`/transactions/${encodeURIComponent(record.id)}`}>Details →</Link></div>
          </div>;
        })}
      </div>
    </section>}

    {result.totalPages > 1 ? <footer className={styles.pagination}><button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Previous</button><span>Page {result.page} of {result.totalPages}</span><button disabled={page >= result.totalPages} onClick={() => setPage((value) => Math.min(result.totalPages, value + 1))}>Next →</button></footer> : null}
  </div>;
}
