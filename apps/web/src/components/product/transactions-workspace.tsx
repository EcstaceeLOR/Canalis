"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import { solanaExplorerTxUrl } from "./task-detail-model";
import styles from "./transactions-workspace.module.css";

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

type ExplorerResult = {
  events: TransactionEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: {
    totalEvents: number;
    offchainEvents: number;
    onchainEvents: number;
    failedEvents: number;
    authorizedAtomic: string;
    settledAtomic: string;
    recoveredAtomic: string;
  };
};

type ProviderOption = { id: string; name: string; supportedNetworks?: string[] };
type TaskOption = { id: string; name: string };

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
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(Number(unix) * 1000));
}

function short(value?: string, head = 8, tail = 6) {
  if (!value) return "—";
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function typeLabel(type: EventType) {
  const labels: Record<EventType, string> = {
    authorization: "Authorization",
    receipt: "Receipt",
    channel_open: "Channel open",
    settlement: "Settlement",
    distribution: "Distribution",
    recovery: "Recovery",
    failure: "Failure",
  };
  return labels[type];
}

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function TransactionsWorkspace() {
  const { session, status: walletStatus } = useWalletIdentity();
  const [result, setResult] = useState<ExplorerResult>({
    events: [],
    total: 0,
    page: 1,
    pageSize: 25,
    totalPages: 1,
    summary: {
      totalEvents: 0,
      offchainEvents: 0,
      onchainEvents: 0,
      failedEvents: 0,
      authorizedAtomic: "0",
      settledAtomic: "0",
      recoveredAtomic: "0",
    },
  });
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [task, setTask] = useState("all");
  const [provider, setProvider] = useState("all");
  const [protocol, setProtocol] = useState("all");
  const [status, setStatus] = useState("all");
  const [network, setNetwork] = useState("all");
  const [type, setType] = useState("all");
  const [layer, setLayer] = useState("all");
  const [range, setRange] = useState("all");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("task")) setTask(params.get("task")!);
    if (params.get("provider")) setProvider(params.get("provider")!);
    if (params.get("q")) setSearch(params.get("q")!);
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "25", sort });
    if (search.trim()) params.set("q", search.trim());
    if (task !== "all") params.set("task", task);
    if (provider !== "all") params.set("provider", provider);
    if (protocol !== "all") params.set("protocol", protocol);
    if (status !== "all") params.set("status", status);
    if (network !== "all") params.set("network", network);
    if (type !== "all") params.set("type", type);
    if (layer !== "all") params.set("layer", layer);
    if (range !== "all") {
      const seconds = range === "24h" ? 86_400 : range === "7d" ? 604_800 : 2_592_000;
      params.set("from", String(Math.floor(Date.now() / 1000) - seconds));
    }
    return params.toString();
  }, [layer, network, page, provider, protocol, range, search, sort, status, task, type]);

  const loadMetadata = useCallback(async () => {
    if (!session) return;
    const [providersResponse, tasksResponse] = await Promise.all([
      fetch("/api/providers", { credentials: "same-origin", cache: "no-store" }),
      fetch("/api/tasks?page=1&pageSize=50&sort=updated_desc", { credentials: "same-origin", cache: "no-store" }),
    ]);
    if (providersResponse.ok) {
      const body = (await providersResponse.json()) as { providers: ProviderOption[] };
      setProviders(body.providers);
    }
    if (tasksResponse.ok) {
      const body = (await tasksResponse.json()) as { tasks: TaskOption[] };
      setTasks(body.tasks);
    }
  }, [session]);

  const load = useCallback(async () => {
    if (!session) {
      setResult((current) => ({ ...current, events: [], total: 0 }));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/transactions?${queryString}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response));
      setResult((await response.json()) as ExplorerResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load transaction history.");
    } finally {
      setLoading(false);
    }
  }, [queryString, session]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    setPage(1);
  }, [layer, network, provider, protocol, range, search, sort, status, task, type]);

  const networks = useMemo(() => {
    const values = new Set<string>(["application"]);
    for (const item of providers) for (const value of item.supportedNetworks ?? []) values.add(value);
    for (const event of result.events) values.add(event.network);
    return [...values].filter(Boolean).sort();
  }, [providers, result.events]);

  const exportBase = `/api/transactions/export?${queryString.replace(/(^|&)page=\d+&?/, "$1").replace(/(^|&)pageSize=\d+&?/, "$1")}`;
  const unsettled = BigInt(result.summary.authorizedAtomic) - BigInt(result.summary.settledAtomic);

  function resetFilters() {
    setSearch("");
    setTask("all");
    setProvider("all");
    setProtocol("all");
    setStatus("all");
    setNetwork("all");
    setType("all");
    setLayer("all");
    setRange("all");
    setSort("newest");
  }

  if (!session) {
    return (
      <section className={styles.connect}>
        <div>≡</div>
        <div>
          <h2>Connect your wallet to open the audit ledger</h2>
          <p>{walletStatus === "loading" ? "Checking your existing session…" : "Transactions, receipts, settlements, distributions, and recoveries are scoped to the authenticated wallet."}</p>
        </div>
      </section>
    );
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.summary}>
        <div><span>Events</span><strong>{result.summary.totalEvents}</strong><small>{result.summary.offchainEvents} off-chain · {result.summary.onchainEvents} on-chain</small></div>
        <div><span>Authorized spend</span><strong>{usd(result.summary.authorizedAtomic)}</strong><small>Approved payment deltas</small></div>
        <div className={styles.good}><span>Settled spend</span><strong>{usd(result.summary.settledAtomic)}</strong><small>Unique cumulative increases</small></div>
        <div className={styles.good}><span>Recovered</span><strong>{usd(result.summary.recoveredAtomic)}</strong><small>Refunded channel escrow</small></div>
        <div className={unsettled > 0n ? styles.warn : styles.good}><span>Authorized not settled</span><strong>{usd((unsettled > 0n ? unsettled : 0n).toString())}</strong><small>{result.summary.failedEvents} failed event{result.summary.failedEvents === 1 ? "" : "s"}</small></div>
      </section>

      <section className={styles.toolbar}>
        <input aria-label="Search transactions" placeholder="Search task, channel, provider, receipt hash, signature…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="Filter task" value={task} onChange={(event) => setTask(event.target.value)}><option value="all">All tasks</option>{tasks.map((item) => <option value={item.id} key={item.id}>{item.name || short(item.id)}</option>)}</select>
        <select aria-label="Filter provider" value={provider} onChange={(event) => setProvider(event.target.value)}><option value="all">All providers</option>{providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
        <select aria-label="Filter protocol" value={protocol} onChange={(event) => setProtocol(event.target.value)}><option value="all">All protocols</option><option value="demo">Deterministic</option><option value="x402">x402</option><option value="mpp">MPP</option></select>
        <select aria-label="Filter status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="fulfilled">Fulfilled</option><option value="authorized">Authorized</option><option value="confirmed">Confirmed</option><option value="rejected">Rejected</option><option value="failed">Failed</option></select>
        <select aria-label="Filter event type" value={type} onChange={(event) => setType(event.target.value)}><option value="all">All event types</option><option value="authorization">Authorization</option><option value="receipt">Receipt</option><option value="channel_open">Channel open</option><option value="settlement">Settlement</option><option value="distribution">Distribution</option><option value="recovery">Recovery</option><option value="failure">Failure</option></select>
      </section>

      <section className={styles.subtoolbar}>
        <select aria-label="Filter layer" value={layer} onChange={(event) => setLayer(event.target.value)}><option value="all">Off-chain + on-chain</option><option value="offchain">Off-chain only</option><option value="onchain">On-chain only</option></select>
        <select aria-label="Filter network" value={network} onChange={(event) => setNetwork(event.target.value)}><option value="all">All networks</option>{networks.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label="Filter date range" value={range} onChange={(event) => setRange(event.target.value)}><option value="all">Any date</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select>
        <select aria-label="Sort transactions" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount_desc">Largest amount</option><option value="amount_asc">Smallest amount</option></select>
        <button className={styles.reset} type="button" onClick={resetFilters}>Reset filters</button>
        <span className={styles.spacer} />
        <div className={styles.export}><a href={`${exportBase}&format=csv`}>Export CSV</a><a href={`${exportBase}&format=json`}>Export JSON</a></div>
      </section>

      {error ? <div className={styles.error} role="alert">{error}<button type="button" onClick={() => void load()}>Retry</button></div> : null}

      <div className={styles.tableMeta}><div><strong>{result.total}</strong><span>matching audit events</span></div>{loading ? <span>Refreshing ledger…</span> : null}</div>

      {loading && result.events.length === 0 ? (
        <div className={styles.skeletons}>{[0,1,2,3,4].map((value) => <div key={value} />)}</div>
      ) : result.events.length === 0 ? (
        <section className={styles.empty}>
          <div>∅</div>
          <div><h2>No transaction events match this view</h2><p>Change the filters or execute a task. Canalis records authorizations, receipts, channel transactions, settlement, distribution, recovery, and failures in this ledger.</p></div>
        </section>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Event</th><th>Layer / status</th><th>Amount</th><th>Task</th><th>Provider</th><th>Protocol / network</th><th>Evidence</th><th>Time</th></tr></thead>
            <tbody>{result.events.map((event) => {
              const explorer = event.signature ? solanaExplorerTxUrl(event.signature, event.network) : undefined;
              return <tr key={event.id}>
                <td><div className={styles.eventCell}><Link href={`/transactions/${encodeURIComponent(event.id)}`}>{typeLabel(event.eventType)}</Link><small className={styles.mono}>{short(event.id, 12, 8)}</small></div></td>
                <td><div className={styles.badges}><span className={styles.badge} data-layer={event.layer}>{event.layer === "onchain" ? "On-chain" : "Off-chain"}</span><span className={styles.badge} data-status={event.status}>{event.status}</span></div></td>
                <td className={styles.money}>{event.amountAtomic === "0" ? "—" : usd(event.amountAtomic)}</td>
                <td><Link href={`/tasks/${event.taskId}`}>{event.taskName}</Link><div className={styles.mono}>{short(event.taskId)}</div></td>
                <td><Link href={`/providers?provider=${encodeURIComponent(event.providerId)}`}>{event.providerName}</Link><div className={styles.mono}>{event.providerId}</div></td>
                <td><div>{event.protocol.toUpperCase()}</div><div className={styles.mono}>{event.network}</div></td>
                <td>{event.signature ? <div className={styles.signature}>{explorer ? <a href={explorer} target="_blank" rel="noreferrer">{short(event.signature)} ↗</a> : <span className={styles.mono}>{short(event.signature)}</span>}</div> : event.receiptHash ? <span className={styles.mono}>receipt {short(event.receiptHash)}</span> : event.authorizationId ? <span className={styles.mono}>{short(event.authorizationId)}</span> : <span>—</span>}</td>
                <td>{when(event.createdAtUnixSeconds)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}

      {result.totalPages > 1 ? <div className={styles.pagination}><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Previous</button><span>Page {result.page} of {result.totalPages}</span><button type="button" disabled={page >= result.totalPages} onClick={() => setPage((value) => Math.min(result.totalPages, value + 1))}>Next →</button></div> : null}
    </div>
  );
}
