"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import { ConfirmDialog } from "./product-ux";
import styles from "./developer-workspace.module.css";

type Scope =
  | "tasks:read"
  | "tasks:write"
  | "tasks:execute"
  | "channels:read"
  | "channels:write"
  | "receipts:read"
  | "webhooks:read"
  | "webhooks:write";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  environment: "sandbox" | "production";
  status: "active" | "revoked";
  createdAtUnixSeconds: string;
  lastUsedAtUnixSeconds?: string;
};

type Webhook = {
  id: string;
  url: string;
  description: string;
  events: string[];
  enabled: boolean;
  lastSuccessAtUnixSeconds?: string;
  lastFailureAtUnixSeconds?: string;
};

type Delivery = {
  id: string;
  eventId: string;
  subscriptionId: string;
  eventType: string;
  status: "pending" | "succeeded" | "failed";
  attempt: number;
  responseStatus?: number;
  errorCode?: string;
  createdAtUnixSeconds: string;
  nextAttemptAtUnixSeconds?: string;
};

const scopeOptions: Array<{ value: Scope; label: string }> = [
  { value: "tasks:read", label: "Read tasks" },
  { value: "tasks:write", label: "Create tasks" },
  { value: "tasks:execute", label: "Execute provider work" },
  { value: "channels:read", label: "Read channels" },
  { value: "channels:write", label: "Finalize / recover channels" },
  { value: "receipts:read", label: "Read receipts" },
  { value: "webhooks:read", label: "Read webhooks" },
  { value: "webhooks:write", label: "Manage webhooks" },
];

const webhookEvents = [
  "task.created",
  "task.executed",
  "task.completed",
  "task.cancelled",
  "channel.updated",
  "channel.finalized",
  "channel.recovered",
  "payment.authorized",
  "payment.rejected",
  "settlement.completed",
  "settlement.failed",
];

function formatTime(value?: string) {
  if (!value) return "Never";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? new Date(numeric * 1000).toLocaleString() : "Unknown";
}

async function jsonRequest(path: string, init?: RequestInit) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : `Request failed with HTTP ${response.status}`);
  return body;
}

export function DeveloperWorkspace() {
  const { session } = useWalletIdentity();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [keyName, setKeyName] = useState("Agent backend");
  const [keyEnvironment, setKeyEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [keyScopes, setKeyScopes] = useState<Scope[]>(["tasks:read", "tasks:write", "tasks:execute", "channels:read", "receipts:read"]);
  const [issuedToken, setIssuedToken] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookDescription, setWebhookDescription] = useState("Agent lifecycle events");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["task.created", "task.completed", "settlement.completed", "settlement.failed"]);
  const [issuedWebhookSecret, setIssuedWebhookSecret] = useState("");
  const [confirm, setConfirm] = useState<{ title: string; description: string; confirmLabel: string; run: () => Promise<void> } | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      setLoading(false);
      setKeys([]);
      setWebhooks([]);
      setDeliveries([]);
      return;
    }
    try {
      setError("");
      const [keyBody, webhookBody] = await Promise.all([
        jsonRequest("/api/developer/keys"),
        jsonRequest("/api/developer/webhooks"),
      ]);
      setKeys((keyBody.keys ?? []) as ApiKey[]);
      setWebhooks((webhookBody.subscriptions ?? []) as Webhook[]);
      setDeliveries((webhookBody.deliveries ?? []) as Delivery[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Developer settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const activeKeys = useMemo(() => keys.filter((key) => key.status === "active"), [keys]);
  const failedDeliveries = useMemo(() => deliveries.filter((delivery) => delivery.status === "failed"), [deliveries]);

  function toggleScope(scope: Scope) {
    setKeyScopes((current) => current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope]);
  }

  function toggleEvent(event: string) {
    setSelectedEvents((current) => current.includes(event) ? current.filter((value) => value !== event) : [...current, event]);
  }

  async function createKey() {
    if (keyScopes.length === 0) {
      setError("Select at least one API scope.");
      return;
    }
    setBusy("create-key");
    try {
      const body = await jsonRequest("/api/developer/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: keyName, scopes: keyScopes, environment: keyEnvironment }),
      });
      setIssuedToken(String(body.token ?? ""));
      setNotice("API key created. Copy it now; Canalis stores only its hash.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "API key could not be created.");
    } finally { setBusy(""); }
  }

  async function keyAction(key: ApiKey, action: "rotate" | "revoke") {
    setBusy(`${action}:${key.id}`);
    try {
      const body = await jsonRequest(`/api/developer/keys/${encodeURIComponent(key.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (action === "rotate") {
        setIssuedToken(String(body.token ?? ""));
        setNotice("API key rotated. The previous token is invalid immediately.");
      } else setNotice("API key revoked.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "API key action failed.");
    } finally { setBusy(""); }
  }

  async function createWebhook() {
    if (!webhookUrl.trim() || selectedEvents.length === 0) {
      setError("Enter a webhook URL and choose at least one event.");
      return;
    }
    setBusy("create-webhook");
    try {
      const body = await jsonRequest("/api/developer/webhooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, description: webhookDescription, events: selectedEvents }),
      });
      setIssuedWebhookSecret(String(body.secret ?? ""));
      setNotice("Webhook created. Copy the signing secret before leaving this page.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Webhook could not be created.");
    } finally { setBusy(""); }
  }

  async function updateWebhook(webhook: Webhook, enabled: boolean) {
    setBusy(`webhook:${webhook.id}`);
    try {
      await jsonRequest(`/api/developer/webhooks/${encodeURIComponent(webhook.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      setNotice(enabled ? "Webhook enabled." : "Webhook disabled.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Webhook update failed.");
    } finally { setBusy(""); }
  }

  async function rotateWebhook(webhook: Webhook) {
    setBusy(`rotate-webhook:${webhook.id}`);
    try {
      const body = await jsonRequest(`/api/developer/webhooks/${encodeURIComponent(webhook.id)}/rotate`, { method: "POST" });
      setIssuedWebhookSecret(String(body.secret ?? ""));
      setNotice("Webhook signing secret rotated. The previous secret is invalid immediately.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Webhook secret rotation failed.");
    } finally { setBusy(""); }
  }

  async function retryDelivery(delivery: Delivery) {
    setBusy(`retry:${delivery.id}`);
    try {
      await jsonRequest(`/api/developer/webhooks/deliveries/${encodeURIComponent(delivery.id)}/retry`, { method: "POST" });
      setNotice("Webhook retry attempted. Delivery history has been updated.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Webhook retry failed.");
    } finally { setBusy(""); }
  }

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setNotice(`${label} copied.`);
  }

  if (!session) {
    return <section className={styles.empty}><h1>Developers</h1><p>Connect your wallet to issue scoped server credentials and configure webhooks.</p></section>;
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>Developer platform · API v1</span><h1>Connect agents to Canalis.</h1><p>Issue scoped server credentials, subscribe to signed lifecycle events, inspect delivery history, and integrate through the TypeScript SDK.</p></div>
        <div className={styles.headerActions}><a href="https://github.com/EcstaceeLOR/Canalis/blob/main/docs/DEVELOPER_API.md" target="_blank" rel="noreferrer">API docs ↗</a><Link href="/onboarding">Setup guide</Link></div>
      </header>

      {notice ? <div className={styles.notice} role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div> : null}
      {error ? <div className={styles.error} role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div> : null}
      {loading ? <div className={styles.loading} aria-busy="true">Loading developer configuration…</div> : null}

      <section className={styles.metrics} aria-label="Developer integration summary">
        <article><span>Active API keys</span><strong>{activeKeys.length}</strong><small>Hash-only credentials</small></article>
        <article><span>Webhook endpoints</span><strong>{webhooks.filter((item) => item.enabled).length}</strong><small>HMAC-signed v1 events</small></article>
        <article><span>Failed deliveries</span><strong>{failedDeliveries.length}</strong><small>Observable and retryable</small></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <div className={styles.cardHeading}><div><span>01</span><h2>API keys</h2><p>Create least-privilege credentials for server-to-server agents.</p></div></div>
          <div className={styles.formGrid}>
            <label><span>Name</span><input value={keyName} onChange={(event) => setKeyName(event.target.value)} maxLength={120} /></label>
            <label><span>Environment</span><select value={keyEnvironment} onChange={(event) => setKeyEnvironment(event.target.value as "sandbox" | "production")}><option value="sandbox">Sandbox / devnet</option><option value="production">Production workspace</option></select></label>
          </div>
          <fieldset className={styles.scopeGrid}><legend>Scopes</legend>{scopeOptions.map((scope) => <label key={scope.value}><input type="checkbox" checked={keyScopes.includes(scope.value)} onChange={() => toggleScope(scope.value)} /><span><strong>{scope.label}</strong><small>{scope.value}</small></span></label>)}</fieldset>
          <button className={styles.primary} type="button" disabled={busy === "create-key"} onClick={() => void createKey()}>{busy === "create-key" ? "Creating…" : "Create API key"}</button>
          {issuedToken ? <div className={styles.secretBox}><span>One-time API token</span><code>{issuedToken}</code><button type="button" onClick={() => void copy(issuedToken, "API token")}>Copy token</button></div> : null}
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeading}><div><span>02</span><h2>Webhook endpoint</h2><p>Receive authenticated lifecycle events without polling Canalis.</p></div></div>
          <label className={styles.fullLabel}><span>HTTPS endpoint</span><input placeholder="https://agent.example.com/webhooks/canalis" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} /></label>
          <label className={styles.fullLabel}><span>Description</span><input value={webhookDescription} onChange={(event) => setWebhookDescription(event.target.value)} maxLength={500} /></label>
          <fieldset className={styles.eventGrid}><legend>Events</legend>{webhookEvents.map((eventName) => <label key={eventName}><input type="checkbox" checked={selectedEvents.includes(eventName)} onChange={() => toggleEvent(eventName)} /><span>{eventName}</span></label>)}</fieldset>
          <button className={styles.primary} type="button" disabled={busy === "create-webhook"} onClick={() => void createWebhook()}>{busy === "create-webhook" ? "Creating…" : "Add webhook"}</button>
          {issuedWebhookSecret ? <div className={styles.secretBox}><span>One-time signing secret</span><code>{issuedWebhookSecret}</code><button type="button" onClick={() => void copy(issuedWebhookSecret, "Webhook secret")}>Copy secret</button></div> : null}
        </article>
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHeading}><div><h2>Issued credentials</h2><p>Rotate keys when a secret changes hands; revoke immediately when access is no longer required.</p></div></div>
        {keys.length === 0 ? <p className={styles.emptyState}>No API keys yet.</p> : <div className={styles.records}>{keys.map((key) => <article className={styles.record} key={key.id}><div><strong>{key.name}</strong><span>{key.prefix}•••• · {key.environment}</span><small>{key.scopes.join(" · ")}</small></div><div className={styles.recordMeta}><span className={key.status === "active" ? styles.good : styles.muted}>{key.status}</span><small>Last used {formatTime(key.lastUsedAtUnixSeconds)}</small></div><div className={styles.recordActions}>{key.status === "active" ? <><button type="button" disabled={busy === `rotate:${key.id}`} onClick={() => setConfirm({ title: "Rotate this API key?", description: "The current token will stop authenticating immediately. A replacement token will be shown once.", confirmLabel: "Rotate key", run: () => keyAction(key, "rotate") })}>Rotate</button><button className={styles.danger} type="button" disabled={busy === `revoke:${key.id}`} onClick={() => setConfirm({ title: "Revoke this API key?", description: "Any agent using this token will lose access immediately.", confirmLabel: "Revoke key", run: () => keyAction(key, "revoke") })}>Revoke</button></> : null}</div></article>)}</div>}
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHeading}><div><h2>Webhook subscriptions</h2><p>Signing secrets are encrypted at rest and never returned after creation or rotation.</p></div></div>
        {webhooks.length === 0 ? <p className={styles.emptyState}>No webhook subscriptions yet.</p> : <div className={styles.records}>{webhooks.map((webhook) => <article className={styles.record} key={webhook.id}><div><strong>{webhook.description || webhook.url}</strong><span className={styles.break}>{webhook.url}</span><small>{webhook.events.join(" · ")}</small></div><div className={styles.recordMeta}><span className={webhook.enabled ? styles.good : styles.muted}>{webhook.enabled ? "enabled" : "disabled"}</span><small>Last success {formatTime(webhook.lastSuccessAtUnixSeconds)}</small></div><div className={styles.recordActions}><button type="button" disabled={busy === `webhook:${webhook.id}`} onClick={() => void updateWebhook(webhook, !webhook.enabled)}>{webhook.enabled ? "Disable" : "Enable"}</button><button type="button" disabled={busy === `rotate-webhook:${webhook.id}`} onClick={() => setConfirm({ title: "Rotate webhook secret?", description: "Requests sent after rotation will be signed with the new secret only.", confirmLabel: "Rotate secret", run: () => rotateWebhook(webhook) })}>Rotate secret</button></div></article>)}</div>}
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHeading}><div><h2>Delivery history</h2><p>Every attempt has a stable event ID and delivery record. Failed attempts can be retried safely.</p></div></div>
        {deliveries.length === 0 ? <p className={styles.emptyState}>No webhook deliveries yet.</p> : <div className={styles.records}>{deliveries.slice(0, 20).map((delivery) => <article className={styles.delivery} key={delivery.id}><div><strong>{delivery.eventType}</strong><span>{delivery.eventId}</span><small>Attempt {delivery.attempt} · {formatTime(delivery.createdAtUnixSeconds)}</small></div><div className={styles.recordMeta}><span className={delivery.status === "succeeded" ? styles.good : delivery.status === "failed" ? styles.bad : styles.muted}>{delivery.status}</span><small>{delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : delivery.errorCode ?? "Pending"}</small></div>{delivery.status === "failed" ? <button type="button" disabled={busy === `retry:${delivery.id}`} onClick={() => void retryDelivery(delivery)}>{busy === `retry:${delivery.id}` ? "Retrying…" : "Retry now"}</button> : null}</article>)}</div>}
      </section>

      <section className={styles.quickstart}>
        <div><span className={styles.eyebrow}>TypeScript quickstart</span><h2>From key to paid agent workflow.</h2><p>Use a sandbox key first. Explicit idempotency keys make mutation retries deterministic across network failures.</p></div>
        <pre><code>{`import { CanalisClient } from "@canalis/sdk";

const canalis = new CanalisClient({
  apiKey: process.env.CANALIS_API_KEY!,
});

const created = await canalis.tasks.create({
  name: "research-run",
  mode: "deterministic",
  budgetUsd: "1.00",
  maxPerCallUsd: "0.25",
});

const id = (created.task as { id: string }).id;
await canalis.tasks.execute(id, {
  idempotencyKey: \`execute:\${id}:1\`,
});
const receipts = await canalis.tasks.receipts(id);`}</code></pre>
      </section>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title ?? "Confirm action"}
        description={confirm?.description ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "Confirm"}
        busy={busy.startsWith("rotate") || busy.startsWith("revoke")}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const action = confirm?.run;
          if (!action) return;
          await action();
          setConfirm(null);
        }}
      />
    </div>
  );
}
