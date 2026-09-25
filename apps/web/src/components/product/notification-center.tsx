"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityListResult, ActivityRecord } from "@canalis/application";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./notification-center.module.css";

type Toast = { id: string; message: string; severity: "success" | "warning" | "critical" | "info" };

function responseError(response: Response) {
  return response.json().then((body: { error?: { message?: string } }) => body.error?.message ?? `Request failed (${response.status}).`).catch(() => `Request failed (${response.status}).`);
}

function relative(value: string) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(value));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function eventHref(event: ActivityRecord) {
  if (event.actionHref) return event.actionHref;
  if (event.taskId) return `/tasks/${encodeURIComponent(event.taskId)}`;
  return "/activity";
}

export function NotificationCenter() {
  const { session } = useWalletIdentity();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActivityListResult | null>(null);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const initialized = useRef(false);
  const seen = useRef(new Map<string, string>());

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current.slice(-2), { id, ...toast }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5000);
  }, []);

  const load = useCallback(async (showNew = true) => {
    if (!session) {
      setResult(null);
      initialized.current = false;
      seen.current.clear();
      return;
    }
    try {
      const response = await fetch("/api/activity?page=1&pageSize=8", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const next = await response.json() as ActivityListResult;
      if (initialized.current && showNew) {
        for (const event of next.events) {
          const previousVersion = seen.current.get(event.id);
          if ((!previousVersion || previousVersion !== event.sourceVersion) && !event.read && event.state === "open" && (event.severity === "critical" || event.severity === "warning")) {
            pushToast({ message: event.title, severity: event.severity });
          }
        }
      }
      seen.current = new Map(next.events.map((event) => [event.id, event.sourceVersion]));
      initialized.current = true;
      setResult(next);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Activity unavailable.");
    }
  }, [pushToast, session]);

  useEffect(() => {
    void load(false);
    if (!session) return;
    const timer = window.setInterval(() => void load(true), 30_000);
    function refresh(event: Event) {
      const detail = (event as CustomEvent<{ message?: string; severity?: Toast["severity"] }>).detail;
      if (detail?.message) pushToast({ message: detail.message, severity: detail.severity ?? "info" });
      void load(false);
    }
    window.addEventListener("canalis:activity-refresh", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("canalis:activity-refresh", refresh);
    };
  }, [load, pushToast, session]);

  useEffect(() => {
    function close(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  async function markAllRead() {
    try {
      const response = await fetch("/api/activity/read-all", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response));
      await load(false);
    } catch (caught) {
      pushToast({ message: caught instanceof Error ? caught.message : "Could not mark notifications as read.", severity: "warning" });
    }
  }

  if (!session) return null;
  const unread = result?.unreadCount ?? 0;
  const events = result?.events ?? [];

  return <>
    <div className={styles.root}>
      <button className={styles.trigger} type="button" aria-label={`Activity notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">◉</span>{unread > 0 ? <b>{unread > 99 ? "99+" : unread}</b> : null}
      </button>
      {open ? <div className={styles.panel} role="dialog" aria-label="Notifications">
        <header><div><span>Activity</span><strong>{result?.openCount ?? 0} open incident{(result?.openCount ?? 0) === 1 ? "" : "s"}</strong></div>{unread ? <button type="button" onClick={() => void markAllRead()}>Mark all read</button> : null}</header>
        {error ? <div className={styles.panelError}>{error}<button type="button" onClick={() => void load(false)}>Retry</button></div> : events.length === 0 ? <div className={styles.empty}><strong>All clear</strong><span>No operational activity needs your attention.</span></div> : <div className={styles.events}>
          {events.map((event) => <Link key={event.id} href={eventHref(event)} onClick={() => setOpen(false)} className={`${styles.event} ${styles[`severity_${event.severity}`]} ${event.read ? styles.read : ""}`}>
            <i />
            <div><strong>{event.title}</strong><span>{event.message}</span><small>{event.category} · {relative(event.lastSeenAtUnixSeconds)}{event.state === "open" ? " · open" : ""}</small></div>
          </Link>)}
        </div>}
        <footer><Link href="/activity" onClick={() => setOpen(false)}>Open activity & recovery →</Link></footer>
      </div> : null}
    </div>
    <div className={styles.toasts} aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => <div key={toast.id} className={`${styles.toast} ${styles[`toast_${toast.severity}`]}`}><span>{toast.severity === "success" ? "✓" : toast.severity === "critical" ? "!" : "△"}</span><p>{toast.message}</p><button type="button" aria-label="Dismiss notification" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}>×</button></div>)}
    </div>
  </>;
}
