"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./policies-workspace.module.css";

type Protocol = "demo" | "x402" | "mpp";
type Rules = {
  totalCeilingUsd: string;
  maxPerCallUsd: string;
  allowedProviders: string[];
  blockedProviders: string[];
  providerCapsUsd: Record<string, string>;
  durationMinutes: number;
  allowedNetworks: string[];
  allowedMints: string[];
  allowedProtocols: Protocol[];
};
type PolicyVersion = { policyId: string; version: number; rules: Rules; createdAtUnixSeconds: string };
type Policy = {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  latestVersion: number;
  latest: PolicyVersion;
  usageCount: number;
  createdAtUnixSeconds: string;
  updatedAtUnixSeconds: string;
};
type Provider = { id: string; name: string; protocol: string; status: string; healthStatus: string };
type Form = {
  name: string;
  description: string;
  totalCeilingUsd: string;
  maxPerCallUsd: string;
  durationMinutes: string;
  allowedProviders: string[];
  blockedProviders: string[];
  providerCapsUsd: Record<string, string>;
  allowedNetworks: string;
  allowedMints: string;
  allowedProtocols: Protocol[];
};

const emptyForm: Form = {
  name: "",
  description: "",
  totalCeilingUsd: "1.00",
  maxPerCallUsd: "0.25",
  durationMinutes: "60",
  allowedProviders: [],
  blockedProviders: [],
  providerCapsUsd: {},
  allowedNetworks: "",
  allowedMints: "USDC",
  allowedProtocols: ["demo"],
};

function list(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}
function when(unix: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(Number(unix) * 1000));
}
async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch { return `Request failed (${response.status}).`; }
}
function toForm(policy: Policy): Form {
  return {
    name: policy.name,
    description: policy.description,
    totalCeilingUsd: policy.latest.rules.totalCeilingUsd,
    maxPerCallUsd: policy.latest.rules.maxPerCallUsd,
    durationMinutes: String(policy.latest.rules.durationMinutes),
    allowedProviders: policy.latest.rules.allowedProviders,
    blockedProviders: policy.latest.rules.blockedProviders,
    providerCapsUsd: policy.latest.rules.providerCapsUsd,
    allowedNetworks: policy.latest.rules.allowedNetworks.join(", "),
    allowedMints: policy.latest.rules.allowedMints.join(", "),
    allowedProtocols: policy.latest.rules.allowedProtocols,
  };
}
function rules(form: Form): Rules {
  return {
    totalCeilingUsd: form.totalCeilingUsd,
    maxPerCallUsd: form.maxPerCallUsd,
    durationMinutes: Number(form.durationMinutes),
    allowedProviders: form.allowedProviders,
    blockedProviders: form.blockedProviders,
    providerCapsUsd: Object.fromEntries(Object.entries(form.providerCapsUsd).filter(([providerId, value]) => form.allowedProviders.includes(providerId) && value.trim())),
    allowedNetworks: list(form.allowedNetworks),
    allowedMints: list(form.allowedMints),
    allowedProtocols: form.allowedProtocols,
  };
}

export function PoliciesWorkspace() {
  const { session, status: walletStatus } = useWalletIdentity();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Record<string, PolicyVersion[]>>({});

  const load = useCallback(async () => {
    if (!session) { setPolicies([]); setProviders([]); return; }
    setLoading(true); setError("");
    try {
      const [policyResponse, providerResponse] = await Promise.all([
        fetch(`/api/policies${showArchived ? "?archived=1" : ""}`, { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/providers", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (!policyResponse.ok) throw new Error(await responseError(policyResponse));
      if (!providerResponse.ok) throw new Error(await responseError(providerResponse));
      setPolicies(((await policyResponse.json()) as { policies: Policy[] }).policies);
      setProviders(((await providerResponse.json()) as { providers: Provider[] }).providers);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load policies."); }
    finally { setLoading(false); }
  }, [session, showArchived]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return policies.filter((policy) => !q || [policy.name, policy.description, policy.id, ...policy.latest.rules.allowedProviders].join(" ").toLowerCase().includes(q));
  }, [policies, search]);

  function beginCreate() {
    const defaultProviders = providers.filter((provider) => provider.status === "active").slice(0, 3).map((provider) => provider.id);
    setEditing(null);
    setForm({ ...emptyForm, allowedProviders: defaultProviders });
    setOpen(true); setError(""); setNotice("");
  }
  function beginEdit(policy: Policy) { setEditing(policy); setForm(toForm(policy)); setOpen(true); setError(""); setNotice(""); }

  async function save() {
    setBusy("save"); setError(""); setNotice("");
    try {
      const response = await fetch(editing ? `/api/policies/${editing.id}` : "/api/policies", {
        method: editing ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: form.name, description: form.description, rules: rules(form) }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setOpen(false);
      setNotice(editing ? "Policy updated. Rule changes created a new immutable version." : "Reusable policy created.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save policy."); }
    finally { setBusy(""); }
  }

  async function lifecycle(policy: Policy, action: "duplicate" | "archive") {
    setBusy(`${action}:${policy.id}`); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/policies/${policy.id}/lifecycle`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice(action === "duplicate" ? "Policy duplicated as a new active policy." : "Policy archived. Existing task snapshots remain unchanged.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : `Could not ${action} policy.`); }
    finally { setBusy(""); }
  }

  async function toggleVersions(policy: Policy) {
    if (versions[policy.id]) { setVersions((current) => { const next = { ...current }; delete next[policy.id]; return next; }); return; }
    setBusy(`versions:${policy.id}`);
    try {
      const response = await fetch(`/api/policies/${policy.id}/versions`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      setVersions((current) => ({ ...current, [policy.id]: ((await response.json()) as { versions: PolicyVersion[] }).versions }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load version history."); }
    finally { setBusy(""); }
  }

  if (!session) return <section className={styles.connect}><div>◇</div><section><h2>Connect your wallet to manage spending policies</h2><p>{walletStatus === "loading" ? "Checking your session…" : "Reusable policies are private to the wallet that owns them."}</p></section></section>;

  return <div className={styles.workspace}>
    <section className={styles.metrics}>
      <div><span>Policies</span><strong>{policies.length}</strong><small>visible in this workspace</small></div>
      <div><span>Active</span><strong>{policies.filter((item) => item.status === "active").length}</strong><small>selectable for new tasks</small></div>
      <div><span>Used by tasks</span><strong>{policies.reduce((sum, item) => sum + item.usageCount, 0)}</strong><small>immutable snapshots</small></div>
      <div><span>Versions</span><strong>{policies.reduce((sum, item) => sum + item.latestVersion, 0)}</strong><small>policy history retained</small></div>
    </section>
    <section className={styles.toolbar}>
      <input aria-label="Search policies" placeholder="Search policies, providers, IDs…" value={search} onChange={(event) => setSearch(event.target.value)} />
      <label><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label>
      <button type="button" onClick={beginCreate}>New policy ＋</button>
    </section>
    {notice ? <div className={styles.notice}>{notice}</div> : null}
    {error ? <div className={styles.error}>{error}<button onClick={() => setError("")}>×</button></div> : null}
    {loading && policies.length === 0 ? <div className={styles.loading}>Loading policy library…</div> : filtered.length === 0 ? <section className={styles.empty}><div>◇</div><div><h2>No reusable policies yet</h2><p>Create a policy once, version it safely, and reuse it across autonomous payment tasks.</p></div><button onClick={beginCreate}>Create policy</button></section> : <section className={styles.grid}>
      {filtered.map((policy) => <article className={styles.card} key={policy.id}>
        <header><div><span className={styles.eyebrow}>{policy.status} · v{policy.latestVersion}</span><h2>{policy.name}</h2><code>{policy.id}</code></div><span className={styles.status} data-status={policy.status}>{policy.status}</span></header>
        <p>{policy.description || "No description"}</p>
        <div className={styles.rules}>
          <div><span>Total ceiling</span><strong>${policy.latest.rules.totalCeilingUsd}</strong></div>
          <div><span>Per call</span><strong>${policy.latest.rules.maxPerCallUsd}</strong></div>
          <div><span>Duration</span><strong>{policy.latest.rules.durationMinutes}m</strong></div>
          <div><span>Task usage</span><strong>{policy.usageCount}</strong></div>
        </div>
        <section className={styles.constraints}>
          <div><span>Allowed providers</span><p>{policy.latest.rules.allowedProviders.join(", ")}</p></div>
          <div><span>Protocols</span><p>{policy.latest.rules.allowedProtocols.map((value) => value.toUpperCase()).join(" · ")}</p></div>
          <div><span>Networks</span><p>{policy.latest.rules.allowedNetworks.length ? policy.latest.rules.allowedNetworks.join(", ") : "Any network compatible with the task mode"}</p></div>
          <div><span>Assets</span><p>{policy.latest.rules.allowedMints.length ? policy.latest.rules.allowedMints.join(", ") : "Any compatible asset"}</p></div>
        </section>
        {Object.keys(policy.latest.rules.providerCapsUsd).length ? <div className={styles.caps}>{Object.entries(policy.latest.rules.providerCapsUsd).map(([id, cap]) => <span key={id}>{id} ≤ ${cap}</span>)}</div> : null}
        <footer>
          {policy.status === "active" ? <Link className={styles.primaryLink} href={`/tasks/new?policy=${encodeURIComponent(policy.id)}&version=${policy.latestVersion}`}>Use in task →</Link> : null}
          {policy.status === "active" ? <button onClick={() => beginEdit(policy)}>Edit</button> : null}
          <button disabled={Boolean(busy)} onClick={() => void toggleVersions(policy)}>{versions[policy.id] ? "Hide versions" : busy === `versions:${policy.id}` ? "Loading…" : "Versions"}</button>
          <button disabled={Boolean(busy)} onClick={() => void lifecycle(policy, "duplicate")}>Duplicate</button>
          {policy.status === "active" ? <button className={styles.danger} disabled={Boolean(busy)} onClick={() => void lifecycle(policy, "archive")}>Archive</button> : null}
        </footer>
        {versions[policy.id] ? <div className={styles.history}>{versions[policy.id].map((version) => <div key={version.version}><strong>v{version.version}</strong><span>{when(version.createdAtUnixSeconds)}</span><small>${version.rules.totalCeilingUsd} total · ${version.rules.maxPerCallUsd}/call · {version.rules.allowedProviders.length} providers</small><Link href={`/tasks/new?policy=${encodeURIComponent(policy.id)}&version=${version.version}`}>Use this version</Link></div>)}</div> : null}
      </article>)}
    </section>}
    {open ? <PolicyEditor form={form} setForm={setForm} providers={providers} editing={editing} busy={busy === "save"} close={() => setOpen(false)} save={save} /> : null}
  </div>;
}

function PolicyEditor({ form, setForm, providers, editing, busy, close, save }: { form: Form; setForm: React.Dispatch<React.SetStateAction<Form>>; providers: Provider[]; editing: Policy | null; busy: boolean; close: () => void; save: () => Promise<void> }) {
  const toggleProvider = (id: string, target: "allowedProviders" | "blockedProviders") => setForm((current) => {
    const opposite = target === "allowedProviders" ? "blockedProviders" : "allowedProviders";
    const exists = current[target].includes(id);
    return { ...current, [target]: exists ? current[target].filter((value) => value !== id) : [...current[target], id], [opposite]: current[opposite].filter((value) => value !== id) };
  });
  const toggleProtocol = (value: Protocol) => setForm((current) => ({ ...current, allowedProtocols: current.allowedProtocols.includes(value) ? current.allowedProtocols.filter((item) => item !== value) : [...current.allowedProtocols, value] }));
  const valid = form.name.trim().length >= 2 && Number(form.totalCeilingUsd) > 0 && Number(form.maxPerCallUsd) > 0 && Number(form.maxPerCallUsd) <= Number(form.totalCeilingUsd) && Number(form.durationMinutes) > 0 && form.allowedProviders.length > 0 && form.allowedProtocols.length > 0;
  return <div className={styles.backdrop} onMouseDown={close}><section className={styles.editor} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span>{editing ? `Editing v${editing.latestVersion} · rule changes create v${editing.latestVersion + 1}` : "Reusable spending guardrails"}</span><h2>{editing ? `Edit ${editing.name}` : "Create policy"}</h2><p>Tasks copy an immutable policy snapshot. Updating this policy never changes historical task rules.</p></div><button onClick={close}>×</button></header>
    <div className={styles.formGrid}>
      <label><span>Name</span><input autoFocus value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
      <label><span>Duration (minutes)</span><input inputMode="numeric" value={form.durationMinutes} onChange={(event) => setForm((current) => ({ ...current, durationMinutes: event.target.value }))} /></label>
      <label className={styles.wide}><span>Description</span><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
      <label><span>Total task ceiling (USDC)</span><input inputMode="decimal" value={form.totalCeilingUsd} onChange={(event) => setForm((current) => ({ ...current, totalCeilingUsd: event.target.value }))} /></label>
      <label><span>Maximum per call (USDC)</span><input inputMode="decimal" value={form.maxPerCallUsd} onChange={(event) => setForm((current) => ({ ...current, maxPerCallUsd: event.target.value }))} /></label>
      <fieldset className={styles.wide}><legend>Providers</legend><div className={styles.providerRows}>{providers.map((provider) => <div key={provider.id}><strong>{provider.name}<small>{provider.id} · {provider.protocol.toUpperCase()}</small></strong><label><input type="checkbox" checked={form.allowedProviders.includes(provider.id)} onChange={() => toggleProvider(provider.id, "allowedProviders")} /> Allow</label><label><input type="checkbox" checked={form.blockedProviders.includes(provider.id)} onChange={() => toggleProvider(provider.id, "blockedProviders")} /> Block</label>{form.allowedProviders.includes(provider.id) ? <input aria-label={`${provider.name} cap`} inputMode="decimal" placeholder="Optional cap" value={form.providerCapsUsd[provider.id] ?? ""} onChange={(event) => setForm((current) => ({ ...current, providerCapsUsd: { ...current.providerCapsUsd, [provider.id]: event.target.value } }))} /> : null}</div>)}</div></fieldset>
      <fieldset className={styles.wide}><legend>Allowed protocols</legend><div className={styles.checks}>{(["demo", "x402", "mpp"] as Protocol[]).map((value) => <label key={value}><input type="checkbox" checked={form.allowedProtocols.includes(value)} onChange={() => toggleProtocol(value)} /> {value.toUpperCase()}</label>)}</div></fieldset>
      <label><span>Allowed networks</span><input value={form.allowedNetworks} onChange={(event) => setForm((current) => ({ ...current, allowedNetworks: event.target.value }))} placeholder="solana:EtWTR... (comma separated)" /><small>Leave empty for any network compatible with the task mode.</small></label>
      <label><span>Allowed assets / mints</span><input value={form.allowedMints} onChange={(event) => setForm((current) => ({ ...current, allowedMints: event.target.value }))} placeholder="USDC, mint-address" /><small>USDC is normalized to the active sandbox mint for x402 tasks.</small></label>
    </div>
    <footer><button onClick={close}>Cancel</button><button className={styles.primary} disabled={!valid || busy} onClick={() => void save()}>{busy ? "Saving…" : editing ? "Save new version" : "Create policy"}</button></footer>
  </section></div>;
}
