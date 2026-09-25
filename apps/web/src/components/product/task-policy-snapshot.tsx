"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import type { TaskDetailPayload } from "./task-detail-model";
import styles from "./task-policy-snapshot.module.css";

function usd(atomic?: string) {
  if (!atomic) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(atomic) / 1_000_000);
}
async function responseError(response: Response) {
  try { return ((await response.json()) as { error?: { message?: string } }).error?.message ?? `Request failed (${response.status}).`; }
  catch { return `Request failed (${response.status}).`; }
}

export function TaskPolicySnapshot({ taskId }: { taskId: string }) {
  const { session } = useWalletIdentity();
  const [payload, setPayload] = useState<TaskDetailPayload | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      setPayload((await response.json()) as TaskDetailPayload);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load policy snapshot."); }
  }, [session, taskId]);

  useEffect(() => { void load(); }, [load]);
  if (!session || (!payload && !error)) return null;
  if (error) return <section className={styles.error}>Policy snapshot unavailable: {error}</section>;
  if (!payload) return null;

  const task = payload.task;
  const overrides = task.policyOverrides ?? {};
  return <section className={styles.panel} aria-label="Immutable task policy snapshot">
    <header>
      <div><span>Authorization guardrails</span><h2>Immutable policy snapshot</h2><p>These are the exact rules persisted with this task. Reusable policy edits cannot mutate them.</p></div>
      <div className={styles.source}>
        <strong>{task.policySourceName ?? "Inline bounded policy"}</strong>
        {task.policySourceVersion ? <span>v{task.policySourceVersion}</span> : <span>inline</span>}
        {task.policySourceId ? <Link href="/policies">Policy library →</Link> : null}
      </div>
    </header>
    <div className={styles.metrics}>
      <div><span>Total ceiling</span><strong>{usd(task.budgetAtomic)}</strong></div>
      <div><span>Max per call</span><strong>{usd(task.maxPerCallAtomic)}</strong></div>
      <div><span>Providers</span><strong>{task.allowedProviders.length}</strong></div>
      <div><span>Overrides</span><strong>{Object.keys(overrides).length}</strong></div>
    </div>
    <div className={styles.grid}>
      <div><span>Allowed providers</span><p>{task.allowedProviders.join(", ") || "None"}</p></div>
      <div><span>Blocked providers</span><p>{task.blockedProviders.length ? task.blockedProviders.join(", ") : "None"}</p></div>
      <div><span>Protocols</span><p>{task.allowedProtocols.length ? task.allowedProtocols.map((item) => item.toUpperCase()).join(" · ") : "Unrestricted"}</p></div>
      <div><span>Networks</span><p>{task.allowedNetworks.length ? task.allowedNetworks.join(", ") : "Unrestricted"}</p></div>
      <div><span>Assets / mints</span><p>{task.allowedMints.length ? task.allowedMints.join(", ") : task.mint}</p></div>
      <div><span>Provider caps</span><p>{Object.keys(task.providerCapsAtomic).length ? Object.entries(task.providerCapsAtomic).map(([id, cap]) => `${id} ≤ ${usd(cap)}`).join(" · ") : "No provider-specific caps"}</p></div>
    </div>
    <div className={styles.overrides}><span>Explicit task-only overrides</span>{Object.keys(overrides).length ? <code>{JSON.stringify(overrides, null, 2)}</code> : <p>No overrides — the selected policy version was applied exactly.</p>}</div>
  </section>;
}
