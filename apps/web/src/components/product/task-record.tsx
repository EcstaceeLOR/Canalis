"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import {
  buildTaskTimeline,
  hasPartialFailure,
  isPollingStatus,
  solanaExplorerAddressUrl,
  solanaExplorerTxUrl,
  type TaskDetailPayload,
  type TaskFlow,
} from "./task-detail-model";

type DetailTab = "overview" | "timeline" | "flows" | "channels";

function usd(value: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(Number(value) / 1_000_000);
}

function date(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(Number(value) * 1000));
}

function short(value?: string, left = 7, right = 5) {
  if (!value) return "—";
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function percentage(part: string, total: string) {
  const denominator = Number(total);
  if (!denominator) return 0;
  return Math.max(0, Math.min(100, (Number(part) / denominator) * 100));
}

function channelRemaining(ceiling: string, authorized: string) {
  try {
    const remaining = BigInt(ceiling) - BigInt(authorized);
    return remaining > 0n ? remaining.toString() : "0";
  } catch {
    return "0";
  }
}

async function message(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

function FlowEvidence({ flow, network }: { flow: TaskFlow; network?: string }) {
  const settlementUrl = solanaExplorerTxUrl(flow.settlementTransactionSignature, network);
  return (
    <dl className="task-flow-evidence">
      <div><dt>Request</dt><dd>{flow.requestId}</dd></div>
      <div><dt>Quote</dt><dd>{usd(flow.quotedAmountAtomic)}</dd></div>
      <div><dt>Cumulative</dt><dd>{usd(flow.previousCumulativeAtomic)} → {usd(flow.nextCumulativeAtomic)}</dd></div>
      <div><dt>Authorization</dt><dd title={flow.authorizationId}>{short(flow.authorizationId)}</dd></div>
      <div><dt>Payment ref</dt><dd title={flow.paymentReference}>{short(flow.paymentReference)}</dd></div>
      <div><dt>Protocol</dt><dd>{flow.receipt?.protocol ?? "—"}</dd></div>
      <div><dt>Response hash</dt><dd title={flow.receipt?.responseHash}>{short(flow.receipt?.responseHash, 10, 7)}</dd></div>
      <div><dt>Receipt time</dt><dd>{flow.receipt ? date(flow.receipt.timestampUnixSeconds) : "—"}</dd></div>
      {flow.rejectionCode ? <div className="wide"><dt>Policy rejection</dt><dd>{flow.rejectionCode}: {flow.rejectionMessage ?? "Rejected by policy."}</dd></div> : null}
      {flow.errorMessage ? <div className="wide"><dt>Failure</dt><dd>{flow.errorMessage}</dd></div> : null}
      {flow.settlementTransactionSignature ? <div className="wide"><dt>Settlement evidence</dt><dd>{settlementUrl ? <a href={settlementUrl} target="_blank" rel="noreferrer">{short(flow.settlementTransactionSignature, 12, 9)} ↗</a> : short(flow.settlementTransactionSignature, 12, 9)}</dd></div> : null}
    </dl>
  );
}

export function TaskRecord({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { session } = useWalletIdentity();
  const [payload, setPayload] = useState<TaskDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<DetailTab>("overview");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!session) {
      if (!silent) setLoading(false);
      return;
    }
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await message(response));
      setPayload((await response.json()) as TaskDetailPayload);
      setLastSyncedAt(Date.now());
    } catch (caught) {
      if (!silent) setError(caught instanceof Error ? caught.message : "Could not load task.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [session, taskId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!session || !payload || !isPollingStatus(payload.task.status)) return;
    const timer = window.setInterval(() => { void load(true); }, 4_000);
    return () => window.clearInterval(timer);
  }, [load, payload, session]);

  async function mutate(action: "submit" | "cancel" | "archive" | "duplicate" | "rerun") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/lifecycle`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(await message(response));
      const next = (await response.json()) as TaskDetailPayload;
      if ((action === "duplicate" || action === "rerun") && next.task.id !== taskId) {
        router.push(`/tasks/${next.task.id}`);
        return;
      }
      setPayload(next);
      setLastSyncedAt(Date.now());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Task action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/execute`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await message(response));
      await load(true);
      setTab("timeline");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Task execution failed.");
      await load(true);
      setTab("timeline");
    } finally {
      setBusy(false);
    }
  }

  const timeline = useMemo(() => payload ? buildTaskTimeline(payload) : [], [payload]);

  if (!session) {
    return <section className="tasks-connect-state"><div className="empty-symbol">◎</div><div><h2>Connect the wallet that owns this task</h2><p>Canalis does not expose wallet-scoped task data without an authenticated session.</p></div></section>;
  }
  if (loading) return <div className="task-detail-skeleton"><div /><div /><div /></div>;
  if (error && !payload) return <div className="tasks-error" role="alert">{error}<button onClick={() => void load()}>Retry</button></div>;
  if (!payload) return null;

  const { task, graph, channels, settlement } = payload;
  const name = payload.workspace?.name ?? task.agentId;
  const partialFailure = hasPartialFailure(payload);
  const failedHistory = graph.flows.some((flow) => flow.status === "failed" || flow.status === "rejected");
  const canExecute = task.status === "active" && graph.flows.length === 0;
  const polling = isPollingStatus(task.status);

  return (
    <div className="task-record task-operations">
      <div className="task-record-head">
        <div>
          <div className="task-title-badges">
            <span className={`task-status task-status-${task.status}`}><i />{task.status}</span>
            <span className={`task-mode-badge task-mode-${task.mode}`}>{task.mode}</span>
            <span className={`task-settlement-badge task-settlement-${settlement.status}`}>{settlement.status.replaceAll("-", " ")}</span>
          </div>
          <h2>{name}</h2>
          <p>{payload.workspace?.description || "No description supplied for this task."}</p>
          <div className="task-sync-state" aria-live="polite"><span className={polling ? "sync-dot live" : "sync-dot"} />{polling ? "Live · polling persisted state every 4s" : "Persisted snapshot"}{lastSyncedAt ? ` · synced ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}</div>
        </div>
        <div className="task-record-actions">
          <Link className="secondary-action" href="/tasks">All tasks</Link>
          <button className="secondary-action" disabled={busy} onClick={() => void load()}>Refresh</button>
          {task.status === "draft" ? <button className="primary-action" disabled={busy} onClick={() => void mutate("submit")}>Submit draft</button> : null}
          {canExecute ? <button className="primary-action" disabled={busy} onClick={() => void execute()}>Run task <span>→</span></button> : null}
          {["draft", "active"].includes(task.status) ? <button className="secondary-action" disabled={busy} onClick={() => void mutate("cancel")}>Cancel</button> : null}
          {["draft", "completed", "cancelled"].includes(task.status) ? <button className="secondary-action" disabled={busy} onClick={() => void mutate("archive")}>Archive</button> : null}
          <button className="secondary-action" disabled={busy} onClick={() => void mutate("duplicate")}>Duplicate</button>
          {["completed", "cancelled", "archived"].includes(task.status) ? <button className="secondary-action" disabled={busy} onClick={() => void mutate("rerun")}>{failedHistory ? "Create recovery run" : "Re-run"}</button> : null}
        </div>
      </div>

      {error ? <div className="tasks-error" role="alert">{error}</div> : null}
      {partialFailure ? <section className="task-recovery-banner" aria-label="Partial failure recovery"><div><strong>Partial execution needs containment</strong><p>Some provider work is already recorded. Canalis will not blindly replay it because that could duplicate an authorization. Cancel this task to preserve the audit trail, then create a fresh recovery run from the stored snapshot.</p></div><button disabled={busy} onClick={() => void mutate("cancel")}>Contain task</button></section> : null}

      <div className="task-record-metrics">
        <article><span>Budget</span><strong>{usd(task.budgetAtomic)}</strong><small>{task.mint}</small></article>
        <article><span>Authorized / spent</span><strong>{usd(graph.spentAtomic)}</strong><small>{graph.flows.length} provider flow{graph.flows.length === 1 ? "" : "s"}</small></article>
        <article><span>Recoverable</span><strong>{usd(settlement.recoverableAtomic)}</strong><small>{settlement.status === "finalized" ? "Finalized accounting" : "Pending finalization"}</small></article>
        <article><span>Budget used</span><strong>{percentage(graph.spentAtomic, task.budgetAtomic).toFixed(1)}%</strong><small>{channels.length} channel reservation{channels.length === 1 ? "" : "s"}</small></article>
      </div>

      <div className="task-detail-tabs" role="tablist" aria-label="Task detail views">
        {(["overview", "timeline", "flows", "channels"] as DetailTab[]).map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "flows" ? `Provider flows (${graph.flows.length})` : item === "channels" ? `Channels (${channels.length})` : item}</button>)}
      </div>

      {tab === "overview" ? <div className="task-detail-grid">
        <section className="product-card task-budget-panel">
          <div className="task-section-heading"><div><span>Payment graph</span><h3>Budget routing</h3></div><strong>{usd(graph.remainingAtomic)} unspent</strong></div>
          <div className="task-budget-track" aria-label={`${percentage(graph.spentAtomic, graph.budgetAtomic).toFixed(1)} percent of task budget used`}><span style={{ width: `${percentage(graph.spentAtomic, graph.budgetAtomic)}%` }} /></div>
          <div className="task-provider-routes">{graph.providers.map((provider) => <article key={provider.providerId}><header><strong>{provider.providerId}</strong><span>{usd(provider.spentAtomic)} spent</span></header><div className="task-provider-route-bar"><span style={{ width: `${percentage(provider.cumulativeAuthorizedAtomic, provider.channelCeilingAtomic)}%` }} /></div><footer><span>{usd(provider.cumulativeAuthorizedAtomic)} authorized</span><span>{usd(provider.channelCeilingAtomic)} ceiling</span></footer></article>)}</div>
        </section>
        <section className="product-card task-record-config"><div className="task-section-heading"><div><span>Configuration</span><h3>Task policy snapshot</h3></div><strong>{payload.workspace?.policyId ?? "inline-bounded"}</strong></div><dl><div><dt>Task ID</dt><dd>{task.id}</dd></div><div><dt>Owner</dt><dd>{task.owner}</dd></div><div><dt>Agent</dt><dd>{task.agentId}</dd></div><div><dt>Mode</dt><dd>{task.mode}</dd></div><div><dt>Max per call</dt><dd>{task.maxPerCallAtomic ? usd(task.maxPerCallAtomic) : "—"}</dd></div><div><dt>Created</dt><dd>{date(task.createdAtUnixSeconds)}</dd></div><div><dt>Expires</dt><dd>{date(task.expiresAtUnixSeconds)}</dd></div><div><dt>Providers</dt><dd><span className="provider-chips">{task.allowedProviders.map((provider) => <span key={provider}>{provider}</span>)}</span></dd></div></dl></section>
      </div> : null}

      {tab === "timeline" ? <section className="product-card task-timeline-panel"><div className="task-section-heading"><div><span>Durable event history</span><h3>Execution timeline</h3></div><strong>{timeline.length} event{timeline.length === 1 ? "" : "s"}</strong></div>{timeline.length === 1 && graph.flows.length === 0 ? <div className="task-panel-empty"><strong>No provider execution yet</strong><p>Run the task to populate request, quote, policy, authorization and receipt events.</p></div> : <ol className="task-timeline">{timeline.map((event) => <li key={event.id} className={`timeline-${event.tone}`}><div className="timeline-marker" /><div className="timeline-body"><header><div><span>{event.stage}{event.providerId ? ` · ${event.providerId}` : ""}</span><strong>{event.title}</strong></div><time>{date(event.timestampUnixSeconds)}</time></header><p>{event.detail}</p>{event.evidence ? <div className="timeline-evidence"><span>{event.evidence.label}</span>{event.evidence.url ? <a href={event.evidence.url} target="_blank" rel="noreferrer" title={event.evidence.value}>{short(event.evidence.value, 14, 10)} ↗</a> : <code title={event.evidence.value}>{short(event.evidence.value, 14, 10)}</code>}</div> : null}</div></li>)}</ol>}</section> : null}

      {tab === "flows" ? <section className="task-flow-list"><div className="task-section-heading"><div><span>Provider inspection</span><h3>Payment flows & receipts</h3></div><strong>{graph.flows.length} recorded</strong></div>{graph.flows.length === 0 ? <div className="product-card task-panel-empty"><strong>No payment flows recorded</strong><p>This task has not routed a provider request yet.</p></div> : graph.flows.map((flow) => { const channel = channels.find((item) => item.providerId === flow.providerId); return <article className={`product-card task-flow-card task-flow-${flow.status}`} key={flow.id}><header><div><span className="task-flow-provider">{flow.providerId}</span><h3>{flow.requestId}</h3></div><span className={`task-flow-status status-${flow.status}`}>{flow.status}</span></header><FlowEvidence flow={flow} network={channel?.network} /></article>; })}</section> : null}

      {tab === "channels" ? <section className="task-channel-list"><div className="task-section-heading"><div><span>Provider reservations</span><h3>Channel state</h3></div><strong>{settlement.status.replaceAll("-", " ")}</strong></div>{channels.map((channel) => { const addressUrl = solanaExplorerAddressUrl(channel.channelAddress, channel.network); const txEntries = [["Open", channel.openTransactionSignature], ["Settle", channel.settleTransactionSignature], ["Distribution", channel.distributionTransactionSignature], ["Refund", channel.refundTransactionSignature]] as const; return <article className="product-card task-channel-card" key={channel.providerId}><header><div><span>{channel.network}</span><h3>{channel.providerId}</h3></div><span className={`channel-state channel-state-${channel.status}`}>{channel.status}</span></header><div className="channel-accounting"><div><span>Ceiling</span><strong>{usd(channel.ceilingAtomic)}</strong></div><div><span>Authorized</span><strong>{usd(channel.cumulativeAuthorizedAtomic)}</strong></div><div><span>Spent</span><strong>{usd(channel.spentAtomic)}</strong></div><div><span>Remaining escrow</span><strong>{usd(channelRemaining(channel.ceilingAtomic, channel.cumulativeAuthorizedAtomic))}</strong></div></div><dl className="channel-evidence"><div><dt>Program</dt><dd title={channel.programAddress}>{short(channel.programAddress, 12, 9)}</dd></div><div><dt>Channel</dt><dd>{channel.channelAddress ? addressUrl ? <a href={addressUrl} target="_blank" rel="noreferrer" title={channel.channelAddress}>{short(channel.channelAddress, 12, 9)} ↗</a> : short(channel.channelAddress, 12, 9) : <span className="evidence-pending">Not opened on-chain</span>}</dd></div>{txEntries.filter(([, signature]) => Boolean(signature)).map(([label, signature]) => <div key={label}><dt>{label}</dt><dd><a href={solanaExplorerTxUrl(signature, channel.network)} target="_blank" rel="noreferrer" title={signature}>{short(signature, 12, 9)} ↗</a></dd></div>)}</dl>{channel.recoveryState ? <details className="channel-recovery-state"><summary>Recovery state</summary><pre>{JSON.stringify(channel.recoveryState, null, 2)}</pre></details> : null}</article>; })}</section> : null}
    </div>
  );
}
