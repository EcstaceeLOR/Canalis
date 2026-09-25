"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./providers-workspace.module.css";

type ProviderStatus = "active" | "disabled";
type HealthStatus = "unknown" | "healthy" | "unhealthy";
type Protocol = "demo" | "x402" | "mpp";

type Provider = {
  id: string;
  name: string;
  description: string;
  protocol: Protocol;
  mode: "deterministic" | "x402" | "mpp";
  endpoint?: string;
  payee: string;
  ownerWallet?: string;
  systemManaged: boolean;
  status: ProviderStatus;
  healthStatus: HealthStatus;
  supportedNetworks: string[];
  supportedAssets: string[];
  pricingModel: "fixed" | "challenge" | "metered";
  fixedPriceAtomic?: string;
  defaultChannelCeilingAtomic?: string;
  policyMetadata: Record<string, unknown>;
  hasCredential: boolean;
  credentialKind?: "bearer" | "api-key";
  credentialHeaderName?: string;
  lastHealthCheckAtUnixSeconds?: string;
  lastSuccessAtUnixSeconds?: string;
  lastErrorAtUnixSeconds?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  usage: { tasks: number; channels: number; flows: number };
};

type ProviderForm = {
  id: string;
  name: string;
  description: string;
  protocol: Protocol;
  endpoint: string;
  payee: string;
  networks: string;
  assets: string;
  pricingModel: "fixed" | "challenge" | "metered";
  fixedPriceUsd: string;
  defaultChannelCeilingUsd: string;
  credentialKind: "none" | "bearer" | "api-key";
  credentialHeaderName: string;
  credentialSecret: string;
};

const blankForm: ProviderForm = {
  id: "",
  name: "",
  description: "",
  protocol: "x402",
  endpoint: "",
  payee: "",
  networks: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  assets: "USDC",
  pricingModel: "challenge",
  fixedPriceUsd: "",
  defaultChannelCeilingUsd: "0.25",
  credentialKind: "none",
  credentialHeaderName: "x-api-key",
  credentialSecret: "",
};

function money(atomic?: string) {
  if (!atomic) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(Number(atomic) / 1_000_000);
}

function when(unix?: string) {
  if (!unix) return "Never";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(Number(unix) * 1000));
}

function splitList(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function slug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

function formFor(provider: Provider): ProviderForm {
  return {
    id: provider.id,
    name: provider.name,
    description: provider.description,
    protocol: provider.protocol,
    endpoint: provider.endpoint ?? "",
    payee: provider.payee,
    networks: provider.supportedNetworks.join(", "),
    assets: provider.supportedAssets.join(", "),
    pricingModel: provider.pricingModel,
    fixedPriceUsd: provider.fixedPriceAtomic
      ? String(Number(provider.fixedPriceAtomic) / 1_000_000)
      : "",
    defaultChannelCeilingUsd: provider.defaultChannelCeilingAtomic
      ? String(Number(provider.defaultChannelCeilingAtomic) / 1_000_000)
      : "",
    credentialKind: provider.credentialKind ?? "none",
    credentialHeaderName: provider.credentialHeaderName ?? "x-api-key",
    credentialSecret: "",
  };
}

export function ProvidersWorkspace() {
  const { session, status: walletStatus } = useWalletIdentity();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [protocol, setProtocol] = useState("all");
  const [health, setHealth] = useState("all");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState<ProviderForm>(blankForm);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const load = useCallback(async () => {
    if (!session) {
      setProviders([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/providers", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = (await response.json()) as { providers: Provider[] };
      setProviders(body.providers);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load providers.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return providers.filter((provider) => {
      const matchesQuery =
        !query ||
        [provider.name, provider.id, provider.description, provider.endpoint ?? "", provider.payee]
          .join(" ")
          .toLowerCase()
          .includes(query);
      return (
        matchesQuery &&
        (protocol === "all" || provider.protocol === protocol) &&
        (health === "all" || provider.healthStatus === health) &&
        (status === "all" || provider.status === status)
      );
    });
  }, [health, protocol, providers, search, status]);

  function openCreate() {
    setEditing(null);
    setForm(blankForm);
    setComposerOpen(true);
    setError("");
    setNotice("");
  }

  function openEdit(provider: Provider) {
    if (provider.systemManaged) return;
    setEditing(provider);
    setForm(formFor(provider));
    setComposerOpen(true);
    setError("");
    setNotice("");
  }

  async function save() {
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const credential =
        form.credentialKind !== "none" && form.credentialSecret
          ? {
              kind: form.credentialKind,
              ...(form.credentialKind === "api-key"
                ? { headerName: form.credentialHeaderName }
                : {}),
              secret: form.credentialSecret,
            }
          : undefined;
      const common = {
        name: form.name,
        description: form.description,
        endpoint: form.endpoint || (editing ? null : undefined),
        payee: form.payee,
        supportedNetworks: splitList(form.networks),
        supportedAssets: splitList(form.assets),
        pricingModel: form.pricingModel,
        fixedPriceUsd: form.fixedPriceUsd || (editing ? null : undefined),
        defaultChannelCeilingUsd: form.defaultChannelCeilingUsd || (editing ? null : undefined),
        policyMetadata: {},
        ...(credential ? { credential } : {}),
      };
      const response = await fetch(editing ? `/api/providers/${editing.id}` : "/api/providers", {
        method: editing ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          editing
            ? common
            : {
                ...common,
                id: form.id || slug(form.name),
                protocol: form.protocol,
              },
        ),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setComposerOpen(false);
      setNotice(editing ? "Provider configuration updated." : "Provider added to your registry.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save provider.");
    } finally {
      setBusy("");
    }
  }

  async function changeStatus(provider: Provider) {
    const next = provider.status === "active" ? "disabled" : "active";
    setBusy(`status:${provider.id}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/providers/${provider.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice(next === "active" ? `${provider.name} enabled.` : `${provider.name} disabled.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change provider status.");
    } finally {
      setBusy("");
    }
  }

  async function checkHealth(provider: Provider) {
    setBusy(`health:${provider.id}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/providers/${provider.id}/health`, {
        method: "POST",
        credentials: "same-origin",
      });
      const body = (await response.json()) as {
        provider?: Provider;
        health?: { status: HealthStatus; message: string; latencyMs: number };
        error?: { message?: string };
      };
      if (body.provider) {
        setProviders((current) =>
          current.map((candidate) => (candidate.id === body.provider!.id ? body.provider! : candidate)),
        );
      }
      if (!response.ok) throw new Error(body.health?.message ?? body.error?.message ?? "Health check failed.");
      setNotice(`${provider.name}: ${body.health?.message ?? "healthy"} (${body.health?.latencyMs ?? 0} ms)`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Health check failed.");
    } finally {
      setBusy("");
    }
  }

  if (!session) {
    return (
      <section className={styles.connect}>
        <div>⌁</div>
        <section>
          <h2>Connect your wallet to manage providers</h2>
          <p>
            {walletStatus === "loading"
              ? "Checking your existing session…"
              : "Provider configuration is scoped to the authenticated wallet. System providers remain read-only."}
          </p>
        </section>
      </section>
    );
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.summary}>
        <div><span>Registry</span><strong>{providers.length}</strong><small>available providers</small></div>
        <div><span>Healthy</span><strong>{providers.filter((item) => item.healthStatus === "healthy").length}</strong><small>verified now</small></div>
        <div><span>Live protocols</span><strong>{providers.filter((item) => item.protocol !== "demo").length}</strong><small>x402 + MPP</small></div>
        <div><span>Disabled</span><strong>{providers.filter((item) => item.status === "disabled").length}</strong><small>blocked from tasks</small></div>
      </section>

      <section className={styles.toolbar}>
        <input aria-label="Search providers" placeholder="Search providers, endpoints, payees…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="Filter protocol" value={protocol} onChange={(event) => setProtocol(event.target.value)}><option value="all">All protocols</option><option value="demo">Deterministic</option><option value="x402">x402</option><option value="mpp">MPP</option></select>
        <select aria-label="Filter health" value={health} onChange={(event) => setHealth(event.target.value)}><option value="all">All health</option><option value="healthy">Healthy</option><option value="unknown">Not checked</option><option value="unhealthy">Unhealthy</option></select>
        <select aria-label="Filter status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All status</option><option value="active">Active</option><option value="disabled">Disabled</option></select>
        <button type="button" onClick={openCreate}>Add provider <span>＋</span></button>
      </section>

      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      {error ? <div className={styles.error} role="alert">{error}<button onClick={() => setError("")}>×</button></div> : null}

      {loading && providers.length === 0 ? (
        <div className={styles.skeletons}>{[0, 1, 2].map((item) => <div key={item} />)}</div>
      ) : filtered.length === 0 ? (
        <section className={styles.empty}><div>⌁</div><section><h2>No providers match this view</h2><p>Adjust the filters or add a protocol-backed provider to the registry.</p></section></section>
      ) : (
        <section className={styles.grid}>
          {filtered.map((provider) => (
            <article className={styles.card} key={provider.id}>
              <header>
                <div className={styles.identity}><span>{provider.protocol === "demo" ? "D" : provider.protocol === "x402" ? "X" : "M"}</span><div><h2>{provider.name}</h2><code>{provider.id}</code></div></div>
                <div className={styles.badges}><span data-status={provider.status}>{provider.status}</span><span data-health={provider.healthStatus}>{provider.healthStatus}</span></div>
              </header>
              <p className={styles.description}>{provider.description}</p>
              <dl className={styles.facts}>
                <div><dt>Protocol</dt><dd>{provider.protocol === "demo" ? "Deterministic" : provider.protocol.toUpperCase()}</dd></div>
                <div><dt>Pricing</dt><dd>{provider.pricingModel}{provider.fixedPriceAtomic ? ` · ${money(provider.fixedPriceAtomic)}` : ""}</dd></div>
                <div><dt>Channel ceiling</dt><dd>{money(provider.defaultChannelCeilingAtomic)}</dd></div>
                <div><dt>Credentials</dt><dd>{provider.hasCredential ? `•••••••• · ${provider.credentialKind ?? "configured"}` : "None"}</dd></div>
              </dl>
              <div className={styles.endpoint}><span>Endpoint</span><code title={provider.endpoint}>{provider.endpoint ?? "In-process adapter"}</code></div>
              <div className={styles.constraints}>
                <div><span>Networks</span>{provider.supportedNetworks.length ? provider.supportedNetworks.map((value) => <code key={value}>{value}</code>) : <em>None declared</em>}</div>
                <div><span>Assets</span>{provider.supportedAssets.length ? provider.supportedAssets.map((value) => <code key={value}>{value}</code>) : <em>None declared</em>}</div>
              </div>
              <div className={styles.usage}>
                <div><strong>{provider.usage.tasks}</strong><span>tasks</span></div>
                <div><strong>{provider.usage.channels}</strong><span>channels</span></div>
                <div><strong>{provider.usage.flows}</strong><span>calls</span></div>
              </div>
              <div className={styles.healthDetail}>
                <div><span>Last check</span><strong>{when(provider.lastHealthCheckAtUnixSeconds)}</strong></div>
                {provider.lastErrorMessage ? <p><b>{provider.lastErrorCode ?? "Health error"}</b> · {provider.lastErrorMessage}</p> : <p>{provider.healthStatus === "healthy" ? `Last success ${when(provider.lastSuccessAtUnixSeconds)}` : "Run a health check before using a live provider."}</p>}
              </div>
              <footer>
                <button disabled={Boolean(busy)} onClick={() => void checkHealth(provider)}>{busy === `health:${provider.id}` ? "Checking…" : "Check health"}</button>
                {provider.systemManaged ? <span className={styles.managed}>System managed</span> : <button disabled={Boolean(busy)} onClick={() => openEdit(provider)}>Edit</button>}
                {!provider.systemManaged ? <button disabled={Boolean(busy)} onClick={() => void changeStatus(provider)}>{busy === `status:${provider.id}` ? "Saving…" : provider.status === "active" ? "Disable" : "Enable"}</button> : null}
                <Link href={`/tasks?provider=${encodeURIComponent(provider.id)}`}>Use in task →</Link>
              </footer>
            </article>
          ))}
        </section>
      )}

      {composerOpen ? (
        <ProviderComposer
          form={form}
          setForm={setForm}
          editing={editing}
          busy={busy === "save"}
          close={() => setComposerOpen(false)}
          save={save}
        />
      ) : null}
    </div>
  );
}

function ProviderComposer({
  form,
  setForm,
  editing,
  busy,
  close,
  save,
}: {
  form: ProviderForm;
  setForm: React.Dispatch<React.SetStateAction<ProviderForm>>;
  editing: Provider | null;
  busy: boolean;
  close: () => void;
  save: () => Promise<void>;
}) {
  const live = form.protocol !== "demo";
  const valid =
    form.name.trim().length >= 2 &&
    form.description.trim() &&
    form.payee.trim() &&
    (editing || (form.id || slug(form.name)).length >= 2) &&
    (!live || (form.endpoint.trim() && splitList(form.networks).length > 0 && splitList(form.assets).length > 0)) &&
    (form.pricingModel !== "fixed" || Number(form.fixedPriceUsd) > 0) &&
    (!form.defaultChannelCeilingUsd || Number(form.defaultChannelCeilingUsd) > 0) &&
    (form.credentialKind !== "api-key" || Boolean(form.credentialHeaderName.trim()));

  return (
    <div className={styles.backdrop} onMouseDown={close} role="presentation">
      <section className={styles.composer} role="dialog" aria-modal="true" aria-label={editing ? "Edit provider" : "Add provider"} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{editing ? "Registry configuration" : "New machine-service provider"}</span><h2>{editing ? `Edit ${editing.name}` : "Add provider"}</h2><p>Live providers must declare their protocol constraints and pass health verification before task use. Secrets are encrypted server-side and never returned to this browser.</p></div><button onClick={close}>×</button></header>
        <div className={styles.formGrid}>
          {!editing ? <label><span>Provider ID</span><input value={form.id} onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))} placeholder={slug(form.name) || "provider-id"} /><small>Stable ID used in tasks, channels and receipts.</small></label> : <label><span>Provider ID</span><input disabled value={form.id} /></label>}
          <label><span>Name</span><input autoFocus value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className={styles.wide}><span>Description</span><textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <label><span>Protocol</span><select disabled={Boolean(editing)} value={form.protocol} onChange={(event) => setForm((current) => ({ ...current, protocol: event.target.value as Protocol, pricingModel: event.target.value === "demo" ? "fixed" : current.pricingModel }))}><option value="x402">x402</option><option value="mpp">MPP</option><option value="demo">Deterministic / demo</option></select></label>
          <label><span>Payee</span><input value={form.payee} onChange={(event) => setForm((current) => ({ ...current, payee: event.target.value }))} placeholder="Provider wallet or recipient" /></label>
          <label className={styles.wide}><span>Endpoint {live ? "" : "(optional)"}</span><input value={form.endpoint} onChange={(event) => setForm((current) => ({ ...current, endpoint: event.target.value }))} placeholder="https://provider.example/api/tool" /></label>
          <label><span>Supported networks</span><input value={form.networks} onChange={(event) => setForm((current) => ({ ...current, networks: event.target.value }))} placeholder="solana:devnet, eip155:1" /><small>Comma separated; live health checks verify advertised constraints.</small></label>
          <label><span>Supported assets</span><input value={form.assets} onChange={(event) => setForm((current) => ({ ...current, assets: event.target.value }))} placeholder="USDC, mint-address" /></label>
          <label><span>Pricing model</span><select value={form.pricingModel} onChange={(event) => setForm((current) => ({ ...current, pricingModel: event.target.value as ProviderForm["pricingModel"] }))}><option value="challenge">Protocol challenge</option><option value="metered">Metered</option><option value="fixed">Fixed per call</option></select></label>
          <label><span>Fixed price (USDC)</span><input disabled={form.pricingModel !== "fixed"} inputMode="decimal" value={form.fixedPriceUsd} onChange={(event) => setForm((current) => ({ ...current, fixedPriceUsd: event.target.value }))} placeholder="0.05" /></label>
          <label><span>Default channel ceiling (USDC)</span><input inputMode="decimal" value={form.defaultChannelCeilingUsd} onChange={(event) => setForm((current) => ({ ...current, defaultChannelCeilingUsd: event.target.value }))} placeholder="0.25" /></label>
          <label><span>Credential</span><select value={form.credentialKind} onChange={(event) => setForm((current) => ({ ...current, credentialKind: event.target.value as ProviderForm["credentialKind"] }))}><option value="none">No new credential</option><option value="bearer">Bearer token</option><option value="api-key">API key header</option></select></label>
          {form.credentialKind === "api-key" ? <label><span>Credential header</span><input value={form.credentialHeaderName} onChange={(event) => setForm((current) => ({ ...current, credentialHeaderName: event.target.value }))} placeholder="x-api-key" /></label> : null}
          {form.credentialKind !== "none" ? <label className={styles.wide}><span>{editing?.hasCredential ? "Replace credential" : "Credential value"}</span><input type="password" autoComplete="new-password" value={form.credentialSecret} onChange={(event) => setForm((current) => ({ ...current, credentialSecret: event.target.value }))} placeholder={editing?.hasCredential ? "Leave blank to keep current secret" : "Stored encrypted; never returned"} /></label> : null}
        </div>
        <footer><button onClick={close}>Cancel</button><button className={styles.primary} disabled={!valid || busy} onClick={() => void save()}>{busy ? "Saving…" : editing ? "Save changes" : "Add provider"}</button></footer>
      </section>
    </div>
  );
}
