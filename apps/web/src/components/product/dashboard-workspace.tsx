"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { OperationalDashboard } from "@canalis/application";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./dashboard-workspace.module.css";

function usd(atomic: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(atomic) / 1_000_000);
}

function when(unix: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(Number(unix) * 1000));
}

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

function kindLabel(kind: OperationalDashboard["recentActivity"][number]["kind"]) {
  if (kind === "authorization") return "Payment authorized";
  if (kind === "rejection") return "Payment rejected";
  if (kind === "failure") return "Provider call failed";
  if (kind === "settlement") return "Channel settled";
  if (kind === "distribution") return "Provider paid";
  return "Funds recovered";
}

export function DashboardWorkspace() {
  const { session, status: walletStatus } = useWalletIdentity();
  const [dashboard, setDashboard] = useState<OperationalDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session) {
      setDashboard(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operations/dashboard", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      setDashboard((await response.json()) as OperationalDashboard);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the operational dashboard.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const settlementPercent = useMemo(() => {
    if (!dashboard) return 0;
    const authorized = Number(dashboard.money.authorizedAtomic);
    return authorized > 0 ? Math.min(100, Math.round((Number(dashboard.money.settledAtomic) / authorized) * 100)) : 0;
  }, [dashboard]);

  if (!session) {
    return <section className={styles.connect}>
      <div>◎</div>
      <section><h2>Connect your wallet to open operations</h2><p>{walletStatus === "loading" ? "Checking your existing session…" : "Dashboard metrics are calculated only from tasks, channels, providers, and transactions owned by the authenticated wallet."}</p></section>
    </section>;
  }

  if (loading && !dashboard) {
    return <div className={styles.skeletons}>{[0, 1, 2, 3, 4, 5].map((item) => <div key={item} />)}</div>;
  }

  if (error && !dashboard) {
    return <section className={styles.error} role="alert"><div><strong>Operations could not be loaded</strong><p>{error}</p></div><button onClick={() => void load()}>Retry</button></section>;
  }

  if (!dashboard) return null;

  const isEmpty = dashboard.tasks.total === 0 && dashboard.channels.total === 0 && dashboard.recentActivity.length === 0;
  if (isEmpty) {
    return <section className={styles.empty}>
      <div className={styles.emptyIcon}>∿</div>
      <div><h2>Your operational history starts with the first task</h2><p>There are no persisted tasks, channels, or payment events for this wallet yet. Create a policy-backed task and this dashboard will populate from real execution data.</p></div>
      <div className={styles.emptyActions}><Link href="/tasks/new">Create a task →</Link><Link href="/providers">Configure providers</Link></div>
    </section>;
  }

  return <div className={styles.workspace}>
    {error ? <div className={styles.inlineError}><span>{error}</span><button onClick={() => void load()}>Retry</button></div> : null}

    <section className={styles.metrics}>
      <Link href="/tasks"><span>Active tasks</span><strong>{dashboard.tasks.active}</strong><small>{dashboard.tasks.total} total tasks</small></Link>
      <Link href="/channels"><span>Active channels</span><strong>{dashboard.channels.active}</strong><small>{dashboard.channels.total} total channels</small></Link>
      <Link href="/transactions?kind=authorization"><span>Authorized spend</span><strong>{usd(dashboard.money.authorizedAtomic)}</strong><small>Persisted paid calls</small></Link>
      <Link href="/channels?status=recoverable"><span>Recoverable now</span><strong>{usd(dashboard.money.recoverableAtomic)}</strong><small>{dashboard.channels.recoverable} channels can return funds</small></Link>
      <Link href="/providers"><span>Provider incidents</span><strong>{dashboard.providers.unhealthy + dashboard.providers.unknown}</strong><small>{dashboard.providers.healthy} healthy · {dashboard.providers.disabled} disabled</small></Link>
    </section>

    <section className={styles.moneyGrid}>
      <article className={styles.card}>
        <header><div><span>Money movement</span><h2>Authorized → settled → recovered</h2></div><Link href="/analytics">Open analytics →</Link></header>
        <div className={styles.moneyFlow}>
          <div><span>Authorized</span><strong>{usd(dashboard.money.authorizedAtomic)}</strong><i><b style={{ width: "100%" }} /></i></div>
          <div><span>Settled</span><strong>{usd(dashboard.money.settledAtomic)}</strong><i><b style={{ width: `${settlementPercent}%` }} /></i></div>
          <div><span>Recovered</span><strong>{usd(dashboard.money.recoveredAtomic)}</strong><i><b style={{ width: `${Math.min(100, Math.max(4, Number(dashboard.money.recoveredAtomic) / Math.max(1, Number(dashboard.money.authorizedAtomic)) * 100))}%` }} /></i></div>
        </div>
        <footer><span>Settlement coverage</span><strong>{settlementPercent}%</strong><small>Settled value divided by authorized value. Recovery is shown separately and is never counted as spend.</small></footer>
      </article>

      <article className={styles.card}>
        <header><div><span>Settlement health</span><h2>Channels requiring attention</h2></div><Link href="/channels">Manage channels →</Link></header>
        <div className={styles.healthRows}>
          <div><i data-tone="good" /><span>Settled / recovered</span><strong>{dashboard.channels.settlementHealthy}</strong></div>
          <div><i data-tone="warn" /><span>Settlement pending</span><strong>{dashboard.channels.settlementPending}</strong></div>
          <div><i data-tone="bad" /><span>Action required</span><strong>{dashboard.channels.requiringAction}</strong></div>
          <div><i data-tone="bad" /><span>Failed / ambiguous</span><strong>{dashboard.channels.failed}</strong></div>
        </div>
      </article>
    </section>

    <section className={styles.grid}>
      <article className={styles.card}>
        <header><div><span>Recent tasks</span><h2>Latest workload state</h2></div><Link href="/tasks">All tasks →</Link></header>
        {dashboard.recentTasks.length === 0 ? <p className={styles.muted}>No tasks have been created yet.</p> : <div className={styles.taskList}>{dashboard.recentTasks.map((task) => <Link href={`/tasks/${encodeURIComponent(task.id)}`} key={task.id}>
          <div><strong>{task.name}</strong><small>{task.mode} · updated {when(task.updatedAtUnixSeconds)}</small></div>
          <span className={styles.status} data-status={task.status}>{task.status}</span>
          <div className={styles.taskMoney}><strong>{usd(task.spentAtomic)}</strong><small>of {usd(task.budgetAtomic)}</small></div>
        </Link>)}</div>}
      </article>

      <article className={styles.card}>
        <header><div><span>Channel queue</span><h2>Requires operator action</h2></div><Link href="/channels">Open queue →</Link></header>
        {dashboard.channelsRequiringAction.length === 0 ? <div className={styles.goodState}>✓ No channel currently requires intervention.</div> : <div className={styles.actionList}>{dashboard.channelsRequiringAction.map((channel) => <Link href={`/tasks/${encodeURIComponent(channel.taskId)}`} key={channel.id}>
          <i data-state={channel.operationalStatus} />
          <div><strong>{channel.taskName}</strong><small>{channel.providerName} · {channel.network}</small></div>
          <span>{channel.operationalStatus}</span>
          <b>{channel.nextAction} →</b>
        </Link>)}</div>}
      </article>
    </section>

    <section className={styles.grid}>
      <article className={styles.card}>
        <header><div><span>Provider health</span><h2>Incidents & verification gaps</h2></div><Link href="/providers">Provider registry →</Link></header>
        {dashboard.providerIncidents.length === 0 ? <div className={styles.goodState}>✓ All active providers are currently healthy.</div> : <div className={styles.incidents}>{dashboard.providerIncidents.map((incident) => <Link href="/providers" key={incident.id}>
          <i data-health={incident.healthStatus} />
          <div><strong>{incident.name}</strong><small>{incident.protocol.toUpperCase()} · {incident.lastErrorCode ?? (incident.healthStatus === "unknown" ? "Health check required" : incident.healthStatus)}</small></div>
          <span>{incident.lastErrorMessage ?? (incident.lastHealthCheckAtUnixSeconds ? `Checked ${when(incident.lastHealthCheckAtUnixSeconds)}` : "Not checked yet")}</span>
        </Link>)}</div>}
      </article>

      <article className={styles.card}>
        <header><div><span>Recent activity</span><h2>Persisted payment events</h2></div><Link href="/transactions">Audit explorer →</Link></header>
        {dashboard.recentActivity.length === 0 ? <p className={styles.muted}>No payment activity has been recorded yet.</p> : <div className={styles.activity}>{dashboard.recentActivity.map((activity) => <Link href={`/transactions?task=${encodeURIComponent(activity.taskId)}`} key={activity.id}>
          <i data-kind={activity.kind} />
          <div><strong>{kindLabel(activity.kind)}</strong><small>{activity.taskName} · {activity.providerName}</small></div>
          <span>{usd(activity.amountAtomic)}</span>
          <time>{when(activity.timestampUnixSeconds)}</time>
        </Link>)}</div>}
      </article>
    </section>

    <footer className={styles.freshness}><span>{loading ? "Refreshing operational data…" : `Calculated from persisted records at ${when(dashboard.generatedAtUnixSeconds)}`}</span><button disabled={loading} onClick={() => void load()}>Refresh</button></footer>
  </div>;
}
