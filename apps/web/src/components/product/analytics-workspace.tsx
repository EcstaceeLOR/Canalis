"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnalyticsMoneyBreakdown, OperationalAnalytics } from "@canalis/application";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./analytics-workspace.module.css";

type RangePreset = "24h" | "7d" | "30d" | "custom";

function usd(atomic: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(atomic) / 1_000_000);
}
function when(unix: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(Number(unix) * 1000));
}
function duration(seconds?: number) {
  if (seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 360) / 10}h`;
}
function datetimeLocal(unix: number) {
  const date = new Date(unix * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function unix(value: string) { return Math.floor(new Date(value).getTime() / 1000); }
async function responseError(response: Response) {
  try { const body = (await response.json()) as { error?: { message?: string } }; return body.error?.message ?? `Request failed (${response.status}).`; }
  catch { return `Request failed (${response.status}).`; }
}

function drillHref(dimension: "provider" | "protocol" | "network", key: string, analytics: OperationalAnalytics) {
  const query = new URLSearchParams({
    [dimension]: key,
    from: analytics.range.fromUnixSeconds,
    to: analytics.range.toUnixSeconds,
  });
  return `/transactions?${query.toString()}`;
}

function Breakdown({ title, dimension, rows, analytics }: { title: string; dimension: "task" | "provider" | "protocol" | "network"; rows: AnalyticsMoneyBreakdown[]; analytics: OperationalAnalytics }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.authorizedAtomic) + Number(row.settledAtomic) + Number(row.recoveredAtomic)));
  return <article className={styles.card}>
    <header><div><span>Breakdown</span><h2>{title}</h2></div><small>Top 12</small></header>
    {rows.length === 0 ? <p className={styles.muted}>No money movement in this range.</p> : <div className={styles.breakdown}>{rows.map((row) => {
      const total = Number(row.authorizedAtomic) + Number(row.settledAtomic) + Number(row.recoveredAtomic);
      const href = dimension === "task" ? `/tasks/${encodeURIComponent(row.key)}` : drillHref(dimension, row.key, analytics);
      return <Link href={href} key={row.key}>
        <div><strong>{row.label}</strong><small>{row.count} persisted events</small></div>
        <i><b style={{ width: `${Math.max(3, total / max * 100)}%` }} /></i>
        <div className={styles.breakdownMoney}><strong>{usd(row.authorizedAtomic)}</strong><small>authorized</small></div>
      </Link>;
    })}</div>}
  </article>;
}

export function AnalyticsWorkspace() {
  const { session, status: walletStatus } = useWalletIdentity();
  const [range, setRange] = useState<RangePreset>("7d");
  const now = Math.floor(Date.now() / 1000);
  const [customFrom, setCustomFrom] = useState(() => datetimeLocal(now - 7 * 86_400));
  const [customTo, setCustomTo] = useState(() => datetimeLocal(now));
  const [analytics, setAnalytics] = useState<OperationalAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (range === "custom") {
      const from = unix(customFrom);
      const to = unix(customTo);
      if (Number.isFinite(from)) params.set("from", String(from));
      if (Number.isFinite(to)) params.set("to", String(to));
    }
    return params.toString();
  }, [customFrom, customTo, range]);

  const load = useCallback(async () => {
    if (!session) { setAnalytics(null); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/analytics?${query}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      setAnalytics((await response.json()) as OperationalAnalytics);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load analytics."); }
    finally { setLoading(false); }
  }, [query, session]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), range === "custom" ? 250 : 0); return () => window.clearTimeout(timer); }, [load, range]);

  const chartMax = useMemo(() => analytics ? Math.max(1, ...analytics.series.map((point) => Math.max(Number(point.authorizedAtomic), Number(point.settledAtomic), Number(point.recoveredAtomic)))) : 1, [analytics]);

  if (!session) return <section className={styles.connect}><div>∿</div><div><h2>Connect your wallet to view analytics</h2><p>{walletStatus === "loading" ? "Checking your existing session…" : "Analytics are derived only from persisted records belonging to the authenticated wallet."}</p></div></section>;
  if (loading && !analytics) return <div className={styles.skeletons}>{[0,1,2,3,4,5].map((item) => <div key={item} />)}</div>;
  if (error && !analytics) return <section className={styles.error}><div><strong>Analytics could not be loaded</strong><p>{error}</p></div><button onClick={() => void load()}>Retry</button></section>;

  return <div className={styles.workspace}>
    <section className={styles.rangeBar}>
      <div className={styles.rangeTabs}>{(["24h","7d","30d","custom"] as RangePreset[]).map((value) => <button key={value} data-active={range === value} onClick={() => setRange(value)}>{value === "custom" ? "Custom" : value}</button>)}</div>
      {range === "custom" ? <div className={styles.customRange}><label><span>From</span><input type="datetime-local" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label><label><span>To</span><input type="datetime-local" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label></div> : null}
      {analytics ? <small>{when(analytics.range.fromUnixSeconds)} → {when(analytics.range.toUnixSeconds)}</small> : null}
    </section>
    {error ? <div className={styles.inlineError}><span>{error}</span><button onClick={() => void load()}>Retry</button></div> : null}

    {analytics && analytics.tasks.total === 0 && analytics.calls.total === 0 && Number(analytics.spend.authorizedAtomic) === 0 ? <section className={styles.empty}><div>∿</div><div><h2>No activity in this range</h2><p>Choose a wider range or create and run a task. Canalis does not synthesize analytics when no persisted activity exists.</p></div><Link href="/tasks/new">Create a task →</Link></section> : analytics ? <>
      <section className={styles.metrics}>
        <Link href={`/transactions?kind=authorization&from=${analytics.range.fromUnixSeconds}&to=${analytics.range.toUnixSeconds}`}><span>Authorized</span><strong>{usd(analytics.spend.authorizedAtomic)}</strong><small>{analytics.calls.total - analytics.calls.failed} successful calls</small></Link>
        <Link href={`/transactions?kind=settlement&from=${analytics.range.fromUnixSeconds}&to=${analytics.range.toUnixSeconds}`}><span>Settled</span><strong>{usd(analytics.spend.settledAtomic)}</strong><small>confirmed / terminal channel value</small></Link>
        <Link href={`/transactions?kind=recovery&from=${analytics.range.fromUnixSeconds}&to=${analytics.range.toUnixSeconds}`}><span>Recovered</span><strong>{usd(analytics.spend.recoveredAtomic)}</strong><small>returned channel funds</small></Link>
        <Link href="/tasks"><span>Task success</span><strong>{analytics.rates.taskSuccessPercent}%</strong><small>{analytics.tasks.successful} successful · {analytics.tasks.failed} failed</small></Link>
        <Link href={`/transactions?status=failed,rejected&from=${analytics.range.fromUnixSeconds}&to=${analytics.range.toUnixSeconds}`}><span>Call failure</span><strong>{analytics.rates.callFailurePercent}%</strong><small>{analytics.calls.failed} exceptions</small></Link>
      </section>

      <section className={styles.chartCard}>
        <header><div><span>Time series</span><h2>Money movement over time</h2><p>Each column is an aggregated persisted-data bucket; no client-side event scan is required.</p></div><div className={styles.legend}><span><i data-series="authorized" />Authorized</span><span><i data-series="settled" />Settled</span><span><i data-series="recovered" />Recovered</span></div></header>
        <div className={styles.chart}>{analytics.series.map((point) => <div className={styles.bucket} key={point.bucketStartUnixSeconds} title={`${when(point.bucketStartUnixSeconds)} · authorized ${usd(point.authorizedAtomic)} · settled ${usd(point.settledAtomic)} · recovered ${usd(point.recoveredAtomic)}`}>
          <div className={styles.bars}><i data-series="authorized" style={{ height: `${Math.max(Number(point.authorizedAtomic) ? 3 : 0, Number(point.authorizedAtomic) / chartMax * 100)}%` }} /><i data-series="settled" style={{ height: `${Math.max(Number(point.settledAtomic) ? 3 : 0, Number(point.settledAtomic) / chartMax * 100)}%` }} /><i data-series="recovered" style={{ height: `${Math.max(Number(point.recoveredAtomic) ? 3 : 0, Number(point.recoveredAtomic) / chartMax * 100)}%` }} /></div>
          {point.failures ? <b>{point.failures}</b> : null}
        </div>)}</div>
      </section>

      <section className={styles.reliability}>
        <article className={styles.card}><header><div><span>Reliability</span><h2>Task outcomes</h2></div></header><div className={styles.rates}><div><strong>{analytics.rates.taskSuccessPercent}%</strong><span>Success</span></div><div><strong>{analytics.rates.taskFailurePercent}%</strong><span>Failure</span></div><div><strong>{analytics.tasks.active}</strong><span>Still active</span></div></div></article>
        <article className={styles.card}><header><div><span>Operational latency</span><h2>Settlement & recovery</h2></div></header><div className={styles.rates}><div><strong>{duration(analytics.latency.averageSettlementSeconds)}</strong><span>Avg settlement</span></div><div><strong>{duration(analytics.latency.averageRecoverySeconds)}</strong><span>Avg recovery</span></div><div><strong>{analytics.calls.total}</strong><span>Provider calls</span></div></div></article>
        <article className={styles.card}><header><div><span>Task volume</span><h2>Statuses</h2></div></header><div className={styles.statuses}>{analytics.breakdowns.statuses.length ? analytics.breakdowns.statuses.map((item) => <Link href="/tasks" key={item.key}><span>{item.label}</span><strong>{item.count}</strong></Link>) : <p className={styles.muted}>No tasks in range.</p>}</div></article>
      </section>

      <section className={styles.breakdownGrid}>
        <Breakdown title="By task" dimension="task" rows={analytics.breakdowns.tasks} analytics={analytics} />
        <Breakdown title="By provider" dimension="provider" rows={analytics.breakdowns.providers} analytics={analytics} />
        <Breakdown title="By protocol" dimension="protocol" rows={analytics.breakdowns.protocols} analytics={analytics} />
        <Breakdown title="By network" dimension="network" rows={analytics.breakdowns.networks} analytics={analytics} />
      </section>

      <footer className={styles.note}><span>Breakdowns are capped to the top 12 rows per dimension; time series are server-aggregated into {analytics.range.bucketSeconds / 3600 >= 1 ? `${analytics.range.bucketSeconds / 3600}h` : `${analytics.range.bucketSeconds}s`} buckets for bounded query and response size.</span><span>{loading ? "Refreshing…" : `Generated ${when(analytics.generatedAtUnixSeconds)}`}</span></footer>
    </> : null}
  </div>;
}
