"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";

type TaskPayload = {
  task: {
    id: string;
    owner: string;
    agentId: string;
    mode: string;
    status: string;
    mint: string;
    budgetAtomic: string;
    allowedProviders: string[];
    maxPerCallAtomic?: string;
    createdAtUnixSeconds: string;
    expiresAtUnixSeconds: string;
  };
  graph: { spentAtomic: string; remainingAtomic: string; flows: unknown[] };
  workspace: {
    id: string;
    name: string;
    description: string;
    policyId: string;
    updatedAtUnixSeconds: string;
  } | null;
};

function usd(value: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(value) / 1_000_000);
}

function date(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(Number(value) * 1000));
}

async function message(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function TaskRecord({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { session } = useWalletIdentity();
  const [payload, setPayload] = useState<TaskPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await message(response));
      setPayload((await response.json()) as TaskPayload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load task.");
    } finally {
      setLoading(false);
    }
  }, [session, taskId]);

  useEffect(() => { void load(); }, [load]);

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
      const next = (await response.json()) as TaskPayload;
      if ((action === "duplicate" || action === "rerun") && next.task.id !== taskId) {
        router.push(`/tasks/${next.task.id}`);
        return;
      }
      setPayload(next);
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
      const response = await fetch(`/api/tasks/${taskId}/execute`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(await message(response));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Task execution failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return <section className="tasks-connect-state"><div className="empty-symbol">◎</div><div><h2>Connect the wallet that owns this task</h2><p>Canalis does not expose wallet-scoped task data without an authenticated session.</p></div></section>;
  if (loading) return <div className="task-detail-skeleton"><div /><div /><div /></div>;
  if (error && !payload) return <div className="tasks-error" role="alert">{error}<button onClick={() => void load()}>Retry</button></div>;
  if (!payload) return null;

  const task = payload.task;
  const name = payload.workspace?.name ?? task.agentId;
  return <div className="task-record"><div className="task-record-head"><div><span className={`task-status task-status-${task.status}`}><i />{task.status}</span><h2>{name}</h2><p>{payload.workspace?.description || "No description supplied for this task."}</p></div><div className="task-record-actions"><Link className="secondary-action" href="/tasks">All tasks</Link>{task.status === "draft" ? <button className="primary-action" disabled={busy} onClick={() => void mutate("submit")}>Submit draft</button> : null}{task.status === "active" ? <button className="primary-action" disabled={busy} onClick={() => void execute()}>Run task <span>→</span></button> : null}{["draft","active"].includes(task.status) ? <button className="secondary-action" disabled={busy} onClick={() => void mutate("cancel")}>Cancel</button> : null}{["draft","completed","cancelled"].includes(task.status) ? <button className="secondary-action" disabled={busy} onClick={() => void mutate("archive")}>Archive</button> : null}<button className="secondary-action" disabled={busy} onClick={() => void mutate("duplicate")}>Duplicate</button>{["completed","cancelled","archived"].includes(task.status) ? <button className="secondary-action" disabled={busy} onClick={() => void mutate("rerun")}>Re-run</button> : null}</div></div>{error ? <div className="tasks-error" role="alert">{error}</div> : null}<div className="task-record-metrics"><article><span>Budget</span><strong>{usd(task.budgetAtomic)}</strong><small>{task.mint}</small></article><article><span>Spent</span><strong>{usd(payload.graph.spentAtomic)}</strong><small>{payload.graph.flows.length} provider flow{payload.graph.flows.length === 1 ? "" : "s"}</small></article><article><span>Recoverable</span><strong>{usd(payload.graph.remainingAtomic)}</strong><small>Unspent task budget</small></article><article><span>Policy</span><strong>{payload.workspace?.policyId ?? "inline-bounded"}</strong><small>Snapshot stored with task</small></article></div><section className="product-card task-record-config"><h3>Task configuration</h3><dl><div><dt>Task ID</dt><dd>{task.id}</dd></div><div><dt>Owner</dt><dd>{task.owner}</dd></div><div><dt>Agent</dt><dd>{task.agentId}</dd></div><div><dt>Mode</dt><dd>{task.mode}</dd></div><div><dt>Max per call</dt><dd>{task.maxPerCallAtomic ? usd(task.maxPerCallAtomic) : "—"}</dd></div><div><dt>Created</dt><dd>{date(task.createdAtUnixSeconds)}</dd></div><div><dt>Expires</dt><dd>{date(task.expiresAtUnixSeconds)}</dd></div><div><dt>Providers</dt><dd><span className="provider-chips">{task.allowedProviders.map((provider) => <span key={provider}>{provider}</span>)}</span></dd></div></dl></section><section className="task-detail-next"><strong>Execution inspection</strong><p>Issue #27 expands this persisted task view into the full live request/quote/policy/receipt/settlement timeline. This page already reads the canonical stored task rather than demo state.</p></section></div>;
}
