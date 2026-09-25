"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./policy-task-composer.module.css";

type TaskMode = "deterministic" | "x402" | "mpp";
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
type Policy = {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  latestVersion: number;
  latest: { policyId: string; version: number; rules: Rules; createdAtUnixSeconds: string };
};
type Provider = {
  id: string;
  name: string;
  protocol: "demo" | "x402" | "mpp";
  status: "active" | "disabled";
  healthStatus: "unknown" | "healthy" | "unhealthy";
  executionModes: TaskMode[];
};
type Editable = {
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

function modeForProtocol(protocol: Protocol): TaskMode {
  return protocol === "demo" ? "deterministic" : protocol;
}
function split(value: string) { return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]; }
function sameArray(a: readonly string[], b: readonly string[]) { return [...a].sort().join("\u0000") === [...b].sort().join("\u0000"); }
function sameRecord(a: Record<string, string>, b: Record<string, string>) {
  const normalize = (value: Record<string, string>) => Object.entries(value).filter(([, amount]) => amount.trim()).sort(([aKey], [bKey]) => aKey.localeCompare(bKey));
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
function editable(rules: Rules): Editable {
  return {
    totalCeilingUsd: rules.totalCeilingUsd,
    maxPerCallUsd: rules.maxPerCallUsd,
    durationMinutes: String(rules.durationMinutes),
    allowedProviders: [...rules.allowedProviders],
    blockedProviders: [...rules.blockedProviders],
    providerCapsUsd: { ...rules.providerCapsUsd },
    allowedNetworks: rules.allowedNetworks.join(", "),
    allowedMints: rules.allowedMints.join(", "),
    allowedProtocols: [...rules.allowedProtocols],
  };
}
function responseError(response: Response) {
  return response.json().then((body: { error?: { message?: string } }) => body.error?.message ?? `Request failed (${response.status}).`).catch(() => `Request failed (${response.status}).`);
}

export function PolicyTaskComposer() {
  const { session, status: walletStatus } = useWalletIdentity();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>();
  const [selected, setSelected] = useState<Policy | null>(null);
  const [taskName, setTaskName] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState("canalis-research-agent");
  const [mode, setMode] = useState<TaskMode>("deterministic");
  const [form, setForm] = useState<Editable | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const loadLibrary = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError("");
    try {
      const [policyResponse, providerResponse] = await Promise.all([
        fetch("/api/policies", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/providers", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (!policyResponse.ok) throw new Error(await responseError(policyResponse));
      if (!providerResponse.ok) throw new Error(await responseError(providerResponse));
      const nextPolicies = ((await policyResponse.json()) as { policies: Policy[] }).policies;
      setPolicies(nextPolicies);
      setProviders(((await providerResponse.json()) as { providers: Provider[] }).providers);
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("policy");
      const version = Number.parseInt(params.get("version") ?? "", 10);
      const initial = requested && nextPolicies.some((policy) => policy.id === requested) ? requested : nextPolicies[0]?.id ?? "";
      setSelectedId((current) => current || initial);
      if (requested === initial && Number.isInteger(version) && version > 0) setSelectedVersion(version);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load policy library."); }
    finally { setLoading(false); }
  }, [session]);

  useEffect(() => { void loadLibrary(); }, [loadLibrary]);

  useEffect(() => {
    if (!session || !selectedId) { setSelected(null); setForm(null); return; }
    let cancelled = false;
    void (async () => {
      setLoading(true); setError("");
      try {
        const query = selectedVersion ? `?version=${selectedVersion}` : "";
        const response = await fetch(`/api/policies/${selectedId}${query}`, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error(await responseError(response));
        const policy = ((await response.json()) as { policy: Policy }).policy;
        if (cancelled) return;
        setSelected(policy);
        setSelectedVersion(policy.latest.version);
        setForm(editable(policy.latest.rules));
        const firstProtocol = policy.latest.rules.allowedProtocols[0] ?? "demo";
        setMode(modeForProtocol(firstProtocol));
      } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load policy version."); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedId, selectedVersion && selectedVersion !== selected?.latest.version ? selectedVersion : undefined, session]);

  const overrides = useMemo(() => {
    if (!selected || !form) return {};
    const base = selected.latest.rules;
    const result: Record<string, unknown> = {};
    if (form.totalCeilingUsd !== base.totalCeilingUsd) result.totalCeilingUsd = form.totalCeilingUsd;
    if (form.maxPerCallUsd !== base.maxPerCallUsd) result.maxPerCallUsd = form.maxPerCallUsd;
    if (Number(form.durationMinutes) !== base.durationMinutes) result.durationMinutes = Number(form.durationMinutes);
    if (!sameArray(form.allowedProviders, base.allowedProviders)) result.allowedProviders = form.allowedProviders;
    if (!sameArray(form.blockedProviders, base.blockedProviders)) result.blockedProviders = form.blockedProviders;
    const caps = Object.fromEntries(Object.entries(form.providerCapsUsd).filter(([providerId, value]) => form.allowedProviders.includes(providerId) && value.trim()));
    if (!sameRecord(caps, base.providerCapsUsd)) result.providerCapsUsd = caps;
    const networks = split(form.allowedNetworks);
    if (!sameArray(networks, base.allowedNetworks)) result.allowedNetworks = networks;
    const mints = split(form.allowedMints);
    if (!sameArray(mints, base.allowedMints)) result.allowedMints = mints;
    if (!sameArray(form.allowedProtocols, base.allowedProtocols)) result.allowedProtocols = form.allowedProtocols;
    return result;
  }, [form, selected]);

  const modeProtocol = mode === "deterministic" ? "demo" : mode;
  const effectiveProviders = form?.allowedProviders ?? [];
  const selectedProviderRecords = effectiveProviders.map((id) => providers.find((provider) => provider.id === id)).filter((provider): provider is Provider => Boolean(provider));
  const runtimeReady = selectedProviderRecords.length === effectiveProviders.length && selectedProviderRecords.every((provider) => provider.status === "active" && (provider.protocol === "demo" || provider.healthStatus === "healthy") && provider.executionModes.includes(mode));
  const valid = Boolean(selected && form && taskName.trim() && Number(form.totalCeilingUsd) > 0 && Number(form.maxPerCallUsd) > 0 && Number(form.maxPerCallUsd) <= Number(form.totalCeilingUsd) && Number(form.durationMinutes) > 0 && effectiveProviders.length > 0 && form.allowedProtocols.includes(modeProtocol as Protocol));

  function selectPolicy(value: string) { setSelectedId(value); setSelectedVersion(undefined); }
  function toggleProvider(id: string, target: "allowedProviders" | "blockedProviders") {
    setForm((current) => {
      if (!current) return current;
      const other = target === "allowedProviders" ? "blockedProviders" : "allowedProviders";
      const exists = current[target].includes(id);
      return { ...current, [target]: exists ? current[target].filter((value) => value !== id) : [...current[target], id], [other]: current[other].filter((value) => value !== id) };
    });
  }

  async function create(saveAsDraft: boolean) {
    if (!selected || !form) return;
    setCreating(true); setError("");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: taskName,
          description,
          agentId,
          mode,
          policyId: selected.id,
          policyVersion: selected.latest.version,
          policyOverrides: overrides,
          budgetUsd: form.totalCeilingUsd,
          maxPerCallUsd: form.maxPerCallUsd,
          expiryMinutes: Number(form.durationMinutes),
          allowedProviders: form.allowedProviders,
          saveAsDraft,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = (await response.json()) as { task: { id: string } };
      window.location.assign(`/tasks/${body.task.id}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create task."); setCreating(false); }
  }

  if (!session) return <section className={styles.empty}><div>◎</div><div><h2>Connect your wallet to create a policy-backed task</h2><p>{walletStatus === "loading" ? "Checking your existing session…" : "Policies and tasks are scoped to the authenticated wallet."}</p></div></section>;
  if (!loading && policies.length === 0) return <section className={styles.empty}><div>◇</div><div><h2>Create a reusable policy first</h2><p>A saved policy provides the immutable base version for this task. You can then apply explicit task-only overrides.</p></div><Link href="/policies">Open Policies →</Link></section>;

  return <div className={styles.workspace}>
    {error ? <div className={styles.error}>{error}<button onClick={() => setError("")}>×</button></div> : null}
    <section className={styles.card}>
      <div className={styles.heading}><span>1 · Policy source</span><h2>Select the exact policy version</h2><p>Canalis copies this version into the task. Future edits to the reusable policy cannot alter this task.</p></div>
      <div className={styles.grid}>
        <label><span>Policy</span><select value={selectedId} onChange={(event) => selectPolicy(event.target.value)}>{policies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name} · latest v{policy.latestVersion}</option>)}</select></label>
        <label><span>Version</span><input value={selected?.latest.version ?? selectedVersion ?? ""} readOnly /><small>Choose older versions from the policy version history before opening this composer.</small></label>
      </div>
      {selected ? <div className={styles.policySummary}><strong>{selected.name} · v{selected.latest.version}</strong><span>${selected.latest.rules.totalCeilingUsd} total</span><span>${selected.latest.rules.maxPerCallUsd} / call</span><span>{selected.latest.rules.durationMinutes}m</span><span>{selected.latest.rules.allowedProtocols.map((value) => value.toUpperCase()).join(" / ")}</span></div> : null}
    </section>

    {form && selected ? <>
      <section className={styles.card}>
        <div className={styles.heading}><span>2 · Task identity</span><h2>Define the workload</h2></div>
        <div className={styles.grid}>
          <label><span>Task name</span><input autoFocus value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder="Vendor research with bounded spend" /></label>
          <label><span>Agent ID</span><input value={agentId} onChange={(event) => setAgentId(event.target.value)} /></label>
          <label className={styles.wide}><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What should the agent accomplish?" /></label>
          <label><span>Execution mode</span><select value={mode} onChange={(event) => setMode(event.target.value as TaskMode)}>{form.allowedProtocols.includes("demo") ? <option value="deterministic">Deterministic</option> : null}{form.allowedProtocols.includes("x402") ? <option value="x402">x402 / Solana channels</option> : null}{form.allowedProtocols.includes("mpp") ? <option value="mpp">MPP</option> : null}</select></label>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.heading}><span>3 · Explicit task overrides</span><h2>Adjust only what this task needs</h2><p>Changed fields are persisted as an override delta. Unchanged fields continue to reference the selected version’s values.</p></div>
        <div className={styles.grid}>
          <label><span>Total ceiling (USDC)</span><input inputMode="decimal" value={form.totalCeilingUsd} onChange={(event) => setForm((current) => current && ({ ...current, totalCeilingUsd: event.target.value }))} /></label>
          <label><span>Max per call (USDC)</span><input inputMode="decimal" value={form.maxPerCallUsd} onChange={(event) => setForm((current) => current && ({ ...current, maxPerCallUsd: event.target.value }))} /></label>
          <label><span>Duration (minutes)</span><input inputMode="numeric" value={form.durationMinutes} onChange={(event) => setForm((current) => current && ({ ...current, durationMinutes: event.target.value }))} /></label>
          <label><span>Allowed networks</span><input value={form.allowedNetworks} onChange={(event) => setForm((current) => current && ({ ...current, allowedNetworks: event.target.value }))} placeholder="Comma separated" /></label>
          <label className={styles.wide}><span>Allowed assets / mints</span><input value={form.allowedMints} onChange={(event) => setForm((current) => current && ({ ...current, allowedMints: event.target.value }))} placeholder="USDC, mint-address" /></label>
        </div>
        <fieldset className={styles.providers}><legend>Provider policy</legend>{providers.map((provider) => <div key={provider.id}><strong>{provider.name}<small>{provider.id} · {provider.protocol.toUpperCase()}</small></strong><label><input type="checkbox" checked={form.allowedProviders.includes(provider.id)} onChange={() => toggleProvider(provider.id, "allowedProviders")} /> Allow</label><label><input type="checkbox" checked={form.blockedProviders.includes(provider.id)} onChange={() => toggleProvider(provider.id, "blockedProviders")} /> Block</label>{form.allowedProviders.includes(provider.id) ? <input aria-label={`${provider.name} spending cap`} inputMode="decimal" placeholder="Optional cap" value={form.providerCapsUsd[provider.id] ?? ""} onChange={(event) => setForm((current) => current && ({ ...current, providerCapsUsd: { ...current.providerCapsUsd, [provider.id]: event.target.value } }))} /> : null}</div>)}</fieldset>
        <div className={styles.overrideSummary}><strong>{Object.keys(overrides).length} override{Object.keys(overrides).length === 1 ? "" : "s"}</strong>{Object.keys(overrides).length ? <code>{JSON.stringify(overrides, null, 2)}</code> : <p>No overrides. This task will use policy v{selected.latest.version} exactly.</p>}</div>
      </section>

      <section className={styles.actions}><div><strong>Resolved guardrails</strong><p>${form.totalCeilingUsd} total · ${form.maxPerCallUsd}/call · {form.allowedProviders.length} providers · {form.durationMinutes} minutes · {modeProtocol.toUpperCase()}</p>{valid && !runtimeReady ? <small>Selected providers can be saved in a draft, but an active task requires a connected runtime for every provider.</small> : null}</div><div><button disabled={!valid || creating} onClick={() => void create(true)}>Save draft</button><button className={styles.primary} disabled={!valid || !runtimeReady || creating} onClick={() => void create(false)}>{creating ? "Creating…" : "Create active task →"}</button></div></section>
    </> : loading ? <div className={styles.loading}>Loading policy version…</div> : null}
  </div>;
}
