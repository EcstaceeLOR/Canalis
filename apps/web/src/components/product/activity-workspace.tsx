"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActivityActionKind,
  ActivityCategory,
  ActivityListResult,
  ActivityRecord,
  ActivitySeverity,
} from "@canalis/application";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./activity-workspace.module.css";

const emptyResult: ActivityListResult = {
  events: [], total: 0, unreadCount: 0, openCount: 0, criticalCount: 0, page: 1, pageSize: 25, totalPages: 1,
};

const categoryOptions: Array<{ value: "all" | ActivityCategory; label: string }> = [
  { value: "all", label: "All activity" },
  { value: "task", label: "Tasks" },
  { value: "provider", label: "Providers" },
  { value: "channel", label: "Channels" },
  { value: "settlement", label: "Settlements" },
  { value: "recovery", label: "Recovery" },
  { value: "integration", label: "Integrations" },
];

const severityOptions: Array<{ value: "all" | ActivitySeverity; label: string }> = [
  { value: "all", label: "All severity" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "success", label: "Success" },
  { value: "info", label: "Info" },
];

function when(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(Number(value) * 1000));
}

function responseError(response: Response) {
  return response.json()
    .then((body: { error?: { message?: string } }) => body.error?.message ?? `Request failed (${response.status}).`)
    .catch(() => `Request failed (${response.status}).`);
}

function glyph(event: ActivityRecord) {
  if (event.severity === "critical") return "!";
  if (event.severity === "warning") return "△";
  if (event.severity === "success") return "✓";
  return "·";
}

function actionIsMutation(action: ActivityActionKind) {
  return ["retest-provider", "finalize-channel", "recover-channel"].includes(action);
}

export function ActivityWorkspace() {
  const { session, status: walletStatus } = useWalletIdentity();
  const [result, setResult] = useState<ActivityListResult>(emptyResult);
  const [category, setCategory] = useState<"all" | ActivityCategory>("all");
  const [severity, setSeverity] = useState<"all" | ActivitySeverity>("all");
  const [state, setState] = useState<"all" | "open" | "resolved">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (category !== "all") params.set("category", category);
    if (severity !== "all") params.set("severity", severity);
    if (state !== "all") params.set("state", state);
    if (unreadOnly) params.set("unread", "1");
    return params.toString();
  }, [category, page, severity, state, unreadOnly]);

  const load = useCallback(async () => {
    if (!session) {
      setResult(emptyResult);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/activity?${query}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      setResult(await response.json() as ActivityListResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load activity.");
    } finally {
      setLoading(false);
    }
  }, [query, session]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [category, severity, state, unreadOnly]);

  async function markRead(event: ActivityRecord, read = true) {
    setBusy(event.id);
    try {
      const response = await fetch(`/api/activity/${encodeURIComponent(event.id)}`, {
        method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ read }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      await load();
      window.dispatchEvent(new CustomEvent("canalis:activity-refresh"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update notification state.");
    } finally {
      setBusy("");
    }
  }

  async function markAllRead() {
    setBusy("all");
    setError("");
    try {
      const response = await fetch("/api/activity/read-all", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice("All current activity has been marked as read.");
      await load();
      window.dispatchEvent(new CustomEvent("canalis:activity-refresh"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not mark activity as read.");
    } finally {
      setBusy("");
    }
  }

  async function perform(event: ActivityRecord) {
    if (!actionIsMutation(event.actionKind)) {
      if (event.actionHref) window.location.assign(event.actionHref);
      return;
    }
    setBusy(event.id);
    setError("");
    setNotice("");
    try {
      let response: Response;
      let successMessage: string;
      if (event.actionKind === "retest-provider") {
        if (!event.providerId) throw new Error("This incident is missing its provider reference.");
        response = await fetch(`/api/providers/${encodeURIComponent(event.providerId)}/health`, {
          method: "POST", credentials: "same-origin",
        });
        successMessage = "Provider connection verified. The incident will clear if the provider is healthy.";
      } else {
        if (!event.taskId || !event.providerId) throw new Error("This incident is missing its channel reference.");
        const action = event.actionKind === "recover-channel" ? "recover" : "finalize";
        response = await fetch(`/api/channels/${encodeURIComponent(event.taskId)}/${encodeURIComponent(event.providerId)}/action`, {
          method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        successMessage = action === "recover"
          ? "Unused escrow was recovered. Canalis is reconciling the activity state."
          : "Channel finalization completed. Canalis is reconciling the activity state.";
      }
      if (!response.ok) throw new Error(await responseError(response));
      setNotice(successMessage);
      await load();
      window.dispatchEvent(new CustomEvent("canalis:activity-refresh", { detail: { message: successMessage, severity: "success" } }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Recovery action failed.";
      setError(message);
      window.dispatchEvent(new CustomEvent("canalis:activity-refresh", { detail: { message, severity: "warning" } }));
    } finally {
      setBusy("");
    }
  }

  if (!session) {
    return <section className={styles.connect}><span>◉</span><div><h2>Connect your wallet to view operational activity</h2><p>{walletStatus === "loading" ? "Checking your existing session…" : "Incidents, notifications, and recovery actions are scoped to the authenticated wallet."}</p></div></section>;
  }

  return <div className={styles.workspace}>
    <section className={styles.metrics}>
      <Metric label="Unread" value={String(result.unreadCount)} detail="Needs review" tone={result.unreadCount ? "warning" : "normal"} />
      <Metric label="Open incidents" value={String(result.openCount)} detail="Canonical issues still active" tone={result.openCount ? "warning" : "normal"} />
      <Metric label="Critical" value={String(result.criticalCount)} detail="Automatic retry may be unsafe" tone={result.criticalCount ? "critical" : "normal"} />
      <Metric label="Visible events" value={String(result.total)} detail="Current filtered view" tone="normal" />
    </section>

    <section className={styles.card}>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <select aria-label="Filter activity by category" value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
            {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select aria-label="Filter activity by severity" value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}>
            {severityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select aria-label="Filter activity by incident state" value={state} onChange={(event) => setState(event.target.value as typeof state)}>
            <option value="all">Open + resolved</option><option value="open">Open incidents</option><option value="resolved">Resolved/history</option>
          </select>
          <label className={styles.check}><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />Unread only</label>
        </div>
        <div className={styles.toolbarActions}>
          <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
          <button type="button" onClick={() => void markAllRead()} disabled={busy === "all" || result.unreadCount === 0}>Mark all read</button>
        </div>
      </div>

      {notice ? <div className={styles.notice} role="status"><span>✓</span>{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss success message">×</button></div> : null}
      {error ? <div className={styles.error} role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>Dismiss</button></div> : null}

      {loading && result.events.length === 0 ? <div className={styles.skeletons}>{[0,1,2,3].map((value) => <i key={value} />)}</div> : result.events.length === 0 ? (
        <div className={styles.empty}><span>✓</span><div><h2>No activity matches this view</h2><p>{unreadOnly || state === "open" ? "There are no unresolved notifications matching these filters." : "Canalis will record task, provider, channel, settlement, recovery, and integration activity here."}</p></div></div>
      ) : <div className={styles.list}>
        {result.events.map((event) => <article key={event.id} className={`${styles.event} ${styles[`severity_${event.severity}`]} ${event.read ? styles.read : styles.unread}`}>
          <div className={styles.glyph} aria-hidden="true">{glyph(event)}</div>
          <div className={styles.body}>
            <div className={styles.meta}><span>{event.category}</span><span>·</span><span>{when(event.lastSeenAtUnixSeconds)}</span>{event.occurrenceCount > 1 ? <><span>·</span><b>{event.occurrenceCount} occurrences</b></> : null}</div>
            <h3>{event.title}</h3>
            <p>{event.message}</p>
            {event.guidance ? <div className={styles.guidance}><strong>Safe next step</strong><span>{event.guidance}</span></div> : null}
            <div className={styles.references}>
              {event.taskId ? <Link href={`/tasks/${encodeURIComponent(event.taskId)}`}>Task {event.taskId.slice(0, 15)}…</Link> : null}
              {event.providerId ? <span>Provider · {event.providerId}</span> : null}
              {event.channelAddress ? <span>Channel · {event.channelAddress.slice(0, 12)}…</span> : null}
              {event.errorCode ? <code>{event.errorCode}</code> : null}
              {event.state === "resolved" ? <span className={styles.resolved}>Resolved</span> : <span className={styles.open}>Open</span>}
            </div>
          </div>
          <div className={styles.actions}>
            {event.actionKind !== "none" && event.actionLabel ? (
              actionIsMutation(event.actionKind)
                ? <button type="button" className={styles.primary} disabled={busy === event.id} onClick={() => void perform(event)}>{busy === event.id ? "Working…" : event.actionLabel}</button>
                : event.actionHref ? <Link className={styles.primaryLink} href={event.actionHref}>{event.actionLabel}</Link> : null
            ) : null}
            <button type="button" disabled={busy === event.id} onClick={() => void markRead(event, event.read ? false : true)}>{event.read ? "Mark unread" : "Mark read"}</button>
          </div>
        </article>)}
      </div>}

      {result.totalPages > 1 ? <div className={styles.pagination}><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>← Previous</button><span>Page {result.page} of {result.totalPages}</span><button disabled={page >= result.totalPages} onClick={() => setPage((value) => value + 1)}>Next →</button></div> : null}
    </section>
  </div>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "normal" | "warning" | "critical" }) {
  return <div className={`${styles.metric} ${styles[`metric_${tone}`]}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
