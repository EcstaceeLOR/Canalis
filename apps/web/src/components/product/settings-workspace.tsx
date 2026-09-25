"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./settings-workspace.module.css";

type Environment = "local" | "devnet" | "mainnet";
type Network = "localnet" | "devnet" | "mainnet-beta";
type Mode = "deterministic" | "x402" | "mpp";
type Settings = {
  ownerWallet: string;
  displayName: string;
  environment: Environment;
  solanaNetwork: Network;
  defaultAssetSymbol: string;
  defaultAssetMint?: string;
  explorerCluster: Network;
  taskDefaults: { agentId: string; executionMode: Mode; defaultPolicyId?: string; saveAsDraft: boolean };
  notifications: { taskFailures: boolean; providerIncidents: boolean; settlementFailures: boolean; recoveryRequired: boolean };
  product: { autoRefreshSeconds: number; compactTables: boolean; showAdvancedMetadata: boolean };
  mainnetAcknowledged: boolean;
  updatedAtUnixSeconds?: string;
};
type Policy = { id: string; name: string; status: "active" | "archived"; latestVersion: number };
type Provider = {
  id: string; name: string; description: string; protocol: "demo" | "x402" | "mpp"; endpoint?: string; payee: string;
  systemManaged: boolean; status: "active" | "disabled"; healthStatus: "unknown" | "healthy" | "unhealthy";
  supportedNetworks: string[]; supportedAssets: string[]; pricingModel: "fixed" | "challenge" | "metered";
  fixedPriceAtomic?: string; defaultChannelCeilingAtomic?: string; hasCredential: boolean; credentialKind?: "bearer" | "api-key";
  credentialHeaderName?: string; lastHealthCheckAtUnixSeconds?: string; lastErrorMessage?: string;
};
type IntegrationDraft = {
  id: string; name: string; description: string; protocol: "x402" | "mpp"; endpoint: string; payee: string;
  supportedNetworks: string; supportedAssets: string; pricingModel: "fixed" | "challenge" | "metered";
  fixedPriceUsd: string; defaultChannelCeilingUsd: string; credentialKind: "none" | "bearer" | "api-key";
  credentialHeaderName: string; credentialSecret: string; clearCredential: boolean;
};

const blankIntegration: IntegrationDraft = {
  id: "", name: "", description: "External machine-service integration", protocol: "x402", endpoint: "", payee: "",
  supportedNetworks: "devnet", supportedAssets: "USDC", pricingModel: "challenge", fixedPriceUsd: "",
  defaultChannelCeilingUsd: "0.25", credentialKind: "none", credentialHeaderName: "x-api-key", credentialSecret: "", clearCredential: false,
};

function split(value: string) { return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]; }
function usdFromAtomic(value?: string) {
  if (!value) return "";
  const atomic = BigInt(value); const whole = atomic / 1_000_000n; const fraction = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function responseError(response: Response) {
  return response.json().then((body: { error?: { message?: string } }) => body.error?.message ?? `Request failed (${response.status}).`).catch(() => `Request failed (${response.status}).`);
}
function time(unix?: string) {
  if (!unix) return "Never";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(Number(unix) * 1000));
}
function fingerprint(value: unknown) { return JSON.stringify(value); }

export function SettingsWorkspace() {
  const { session, status: walletStatus } = useWalletIdentity();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savedSettings, setSavedSettings] = useState<Settings | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [integration, setIntegration] = useState<IntegrationDraft>(blankIntegration);
  const [testing, setTesting] = useState(false);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [testedFingerprint, setTestedFingerprint] = useState("");
  const [testMessage, setTestMessage] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError("");
    try {
      const [settingsResponse, policyResponse, providerResponse] = await Promise.all([
        fetch("/api/settings", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/policies", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/providers", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (!settingsResponse.ok) throw new Error(await responseError(settingsResponse));
      if (!policyResponse.ok) throw new Error(await responseError(policyResponse));
      if (!providerResponse.ok) throw new Error(await responseError(providerResponse));
      const next = ((await settingsResponse.json()) as { settings: Settings }).settings;
      setSettings(next); setSavedSettings(next);
      setPolicies(((await policyResponse.json()) as { policies: Policy[] }).policies);
      setProviders(((await providerResponse.json()) as { providers: Provider[] }).providers);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load settings."); }
    finally { setLoading(false); }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const settingsDirty = useMemo(() => Boolean(settings && savedSettings && fingerprint(settings) !== fingerprint(savedSettings)), [savedSettings, settings]);
  const customProviders = providers.filter((provider) => !provider.systemManaged);
  const systemProviders = providers.filter((provider) => provider.systemManaged);

  function updateEnvironment(environment: Environment) {
    if (!settings) return;
    const solanaNetwork: Network = environment === "local" ? "localnet" : environment === "mainnet" ? "mainnet-beta" : "devnet";
    setSettings({
      ...settings,
      environment,
      solanaNetwork,
      explorerCluster: solanaNetwork,
      mainnetAcknowledged: environment === "mainnet" ? settings.mainnetAcknowledged : false,
      taskDefaults: {
        ...settings.taskDefaults,
        executionMode: environment === "mainnet" && settings.taskDefaults.executionMode === "deterministic" ? "x402" : settings.taskDefaults.executionMode,
      },
    });
  }

  async function saveSettings() {
    if (!settings) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/settings", {
        method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(settings),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const next = ((await response.json()) as { settings: Settings }).settings;
      setSettings(next); setSavedSettings(next); setNotice("Workspace settings saved.");
      window.dispatchEvent(new CustomEvent("canalis:settings-updated", { detail: next }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save settings."); }
    finally { setSaving(false); }
  }

  function editProvider(provider: Provider) {
    setEditingId(provider.id);
    setIntegration({
      id: provider.id, name: provider.name, description: provider.description, protocol: provider.protocol === "mpp" ? "mpp" : "x402",
      endpoint: provider.endpoint ?? "", payee: provider.payee, supportedNetworks: provider.supportedNetworks.join(", "),
      supportedAssets: provider.supportedAssets.join(", "), pricingModel: provider.pricingModel,
      fixedPriceUsd: usdFromAtomic(provider.fixedPriceAtomic), defaultChannelCeilingUsd: usdFromAtomic(provider.defaultChannelCeilingAtomic),
      credentialKind: provider.hasCredential ? provider.credentialKind ?? "bearer" : "none", credentialHeaderName: provider.credentialHeaderName ?? "x-api-key",
      credentialSecret: "", clearCredential: false,
    });
    setTestedFingerprint(""); setTestMessage("");
  }

  function newIntegration() {
    const network = settings?.solanaNetwork ?? "devnet";
    const asset = settings?.defaultAssetMint ?? settings?.defaultAssetSymbol ?? "USDC";
    setEditingId(null);
    setIntegration({ ...blankIntegration, supportedNetworks: network, supportedAssets: asset });
    setTestedFingerprint(""); setTestMessage("");
  }

  function integrationPayload() {
    const base: Record<string, unknown> = {
      name: integration.name.trim(), description: integration.description.trim(), endpoint: integration.endpoint.trim(), payee: integration.payee.trim(),
      supportedNetworks: split(integration.supportedNetworks), supportedAssets: split(integration.supportedAssets), pricingModel: integration.pricingModel,
      ...(integration.fixedPriceUsd.trim() ? { fixedPriceUsd: integration.fixedPriceUsd.trim() } : editingId ? { fixedPriceUsd: null } : {}),
      ...(integration.defaultChannelCeilingUsd.trim() ? { defaultChannelCeilingUsd: integration.defaultChannelCeilingUsd.trim() } : editingId ? { defaultChannelCeilingUsd: null } : {}),
    };
    if (!editingId) { base.id = integration.id.trim(); base.protocol = integration.protocol; base.policyMetadata = { configuredFrom: "settings" }; }
    if (integration.credentialKind !== "none" && integration.credentialSecret) {
      base.credential = { kind: integration.credentialKind, secret: integration.credentialSecret, ...(integration.credentialKind === "api-key" ? { headerName: integration.credentialHeaderName.trim() } : {}) };
    } else if (editingId && integration.clearCredential) base.clearCredential = true;
    return base;
  }

  const currentIntegrationFingerprint = fingerprint({ editingId, payload: integrationPayload() });
  const integrationTested = Boolean(testedFingerprint && testedFingerprint === currentIntegrationFingerprint);

  async function testIntegration() {
    setTesting(true); setError(""); setTestMessage("");
    try {
      const response = await fetch("/api/settings/integrations/test", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(editingId ? { providerId: editingId } : {}), config: integrationPayload() }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = (await response.json()) as { health: { latencyMs: number; message: string } };
      setTestedFingerprint(currentIntegrationFingerprint);
      setTestMessage(`${body.health.message} ${body.health.latencyMs}ms`);
    } catch (caught) { setTestedFingerprint(""); setError(caught instanceof Error ? caught.message : "Connection test failed."); }
    finally { setTesting(false); }
  }

  async function saveIntegration() {
    if (!integrationTested) return;
    setIntegrationBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(editingId ? `/api/settings/integrations/${encodeURIComponent(editingId)}` : "/api/settings/integrations", {
        method: editingId ? "PATCH" : "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(integrationPayload()),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice(editingId ? "Integration updated after a successful connection test." : "Integration added and enabled after a successful connection test.");
      newIntegration(); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save integration."); }
    finally { setIntegrationBusy(false); }
  }

  async function toggleProvider(provider: Provider) {
    setIntegrationBusy(true); setError(""); setNotice("");
    try {
      const next = provider.status === "active" ? "disabled" : "active";
      const response = await fetch(`/api/providers/${encodeURIComponent(provider.id)}`, {
        method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: next }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice(next === "active" ? "Integration re-enabled after compatibility and health verification." : "Integration disabled.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not change integration status."); }
    finally { setIntegrationBusy(false); }
  }

  if (!session) return <section className={styles.connect}><span>⚙</span><div><h2>Connect your wallet to configure Canalis</h2><p>{walletStatus === "loading" ? "Checking your session…" : "Settings, integrations, and credentials are isolated by wallet."}</p></div></section>;
  if (loading && !settings) return <div className={styles.loading}>Loading workspace configuration…</div>;
  if (!settings) return <div className={styles.error}>Settings could not be loaded.</div>;

  return <div className={styles.workspace}>
    {settings.environment === "mainnet" ? <section className={styles.mainnetWarning}><strong>Mainnet safety boundary</strong><span>Real-value execution is enabled only with an explicit mint, non-demo runtime, compatible integrations, and acknowledgement below.</span></section> : <section className={styles.environmentBanner} data-env={settings.environment}><strong>{settings.environment.toUpperCase()} workspace</strong><span>{settings.solanaNetwork} · {settings.defaultAssetSymbol}{settings.defaultAssetMint ? ` · ${settings.defaultAssetMint.slice(0, 8)}…` : ""}</span></section>}
    {error ? <div className={styles.error} role="alert"><span>{error}</span><button onClick={() => setError("")}>×</button></div> : null}
    {notice ? <div className={styles.notice}><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div> : null}

    <section className={styles.card}>
      <div className={styles.heading}><span>Account & runtime</span><h2>Workspace environment</h2><p>Network, explorer, and default asset move together so a production workspace cannot silently inherit dev/demo assumptions.</p></div>
      <div className={styles.grid}>
        <label><span>Display name</span><input value={settings.displayName} onChange={(e) => setSettings({ ...settings, displayName: e.target.value })} placeholder="Operations workspace" /></label>
        <label><span>Environment</span><select value={settings.environment} onChange={(e) => updateEnvironment(e.target.value as Environment)}><option value="local">Local development</option><option value="devnet">Devnet</option><option value="mainnet">Mainnet</option></select></label>
        <label><span>Solana network</span><select value={settings.solanaNetwork} onChange={(e) => setSettings({ ...settings, solanaNetwork: e.target.value as Network })}><option value="localnet">Localnet</option><option value="devnet">Devnet</option><option value="mainnet-beta">Mainnet beta</option></select></label>
        <label><span>Explorer cluster</span><select value={settings.explorerCluster} onChange={(e) => setSettings({ ...settings, explorerCluster: e.target.value as Network })}><option value="localnet">Localnet</option><option value="devnet">Devnet</option><option value="mainnet-beta">Mainnet beta</option></select></label>
        <label><span>Default asset symbol</span><input value={settings.defaultAssetSymbol} onChange={(e) => setSettings({ ...settings, defaultAssetSymbol: e.target.value.toUpperCase() })} /></label>
        <label><span>Default asset mint {settings.environment === "mainnet" ? "· required" : "· optional"}</span><input value={settings.defaultAssetMint ?? ""} onChange={(e) => setSettings({ ...settings, defaultAssetMint: e.target.value || undefined })} placeholder="Solana token mint" /></label>
      </div>
      {settings.environment === "mainnet" ? <label className={styles.confirm}><input type="checkbox" checked={settings.mainnetAcknowledged} onChange={(e) => setSettings({ ...settings, mainnetAcknowledged: e.target.checked })} /><span><strong>I understand this workspace can authorize real-value mainnet payments.</strong><small>Canalis will still reject deterministic demo execution and integrations that do not explicitly support this network and asset.</small></span></label> : null}
    </section>

    <section className={styles.card}>
      <div className={styles.heading}><span>Task defaults</span><h2>New task behavior</h2><p>These defaults seed the task composer; saved policies still remain the source of spending guardrails.</p></div>
      <div className={styles.grid}>
        <label><span>Default agent ID</span><input value={settings.taskDefaults.agentId} onChange={(e) => setSettings({ ...settings, taskDefaults: { ...settings.taskDefaults, agentId: e.target.value } })} /></label>
        <label><span>Execution mode</span><select value={settings.taskDefaults.executionMode} onChange={(e) => setSettings({ ...settings, taskDefaults: { ...settings.taskDefaults, executionMode: e.target.value as Mode } })}><option value="deterministic" disabled={settings.environment === "mainnet"}>Deterministic</option><option value="x402">x402</option><option value="mpp">MPP</option></select></label>
        <label><span>Default policy</span><select value={settings.taskDefaults.defaultPolicyId ?? ""} onChange={(e) => setSettings({ ...settings, taskDefaults: { ...settings.taskDefaults, defaultPolicyId: e.target.value || undefined } })}><option value="">No default</option>{policies.filter((p) => p.status === "active").map((policy) => <option key={policy.id} value={policy.id}>{policy.name} · v{policy.latestVersion}</option>)}</select></label>
        <label className={styles.switchRow}><input type="checkbox" checked={settings.taskDefaults.saveAsDraft} onChange={(e) => setSettings({ ...settings, taskDefaults: { ...settings.taskDefaults, saveAsDraft: e.target.checked } })} /><span>Prefer draft creation</span></label>
      </div>
    </section>

    <div className={styles.twoColumn}>
      <section className={styles.card}><div className={styles.heading}><span>Notifications</span><h2>Operational alerts</h2></div><div className={styles.switches}>{Object.entries({ taskFailures: "Task failures", providerIncidents: "Provider incidents", settlementFailures: "Settlement failures", recoveryRequired: "Recovery required" }).map(([key, label]) => <label key={key}><input type="checkbox" checked={settings.notifications[key as keyof Settings["notifications"]]} onChange={(e) => setSettings({ ...settings, notifications: { ...settings.notifications, [key]: e.target.checked } })} /><span>{label}</span></label>)}</div></section>
      <section className={styles.card}><div className={styles.heading}><span>Product</span><h2>Workspace preferences</h2></div><div className={styles.grid}><label><span>Auto refresh</span><select value={settings.product.autoRefreshSeconds} onChange={(e) => setSettings({ ...settings, product: { ...settings.product, autoRefreshSeconds: Number(e.target.value) } })}><option value="0">Off</option><option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="120">2 minutes</option></select></label><label className={styles.switchRow}><input type="checkbox" checked={settings.product.compactTables} onChange={(e) => setSettings({ ...settings, product: { ...settings.product, compactTables: e.target.checked } })} /><span>Compact tables</span></label><label className={styles.switchRow}><input type="checkbox" checked={settings.product.showAdvancedMetadata} onChange={(e) => setSettings({ ...settings, product: { ...settings.product, showAdvancedMetadata: e.target.checked } })} /><span>Show advanced metadata</span></label></div></section>
    </div>

    <div className={styles.saveBar}><div><strong>{settingsDirty ? "Unsaved workspace changes" : "Workspace settings are saved"}</strong><small>{savedSettings?.updatedAtUnixSeconds ? `Last saved ${time(savedSettings.updatedAtUnixSeconds)}` : "Defaults are persisted on first load."}</small></div><div><button disabled={!settingsDirty || saving} onClick={() => savedSettings && setSettings(savedSettings)}>Revert</button><button className={styles.primary} disabled={!settingsDirty || saving} onClick={() => void saveSettings()}>{saving ? "Saving…" : "Save settings"}</button></div></div>

    <section className={styles.card}>
      <div className={styles.headingRow}><div className={styles.heading}><span>Integrations</span><h2>Machine-service adapters</h2><p>External endpoints are tested against the active network and asset before any new configuration is enabled. Secrets are encrypted server-side and never returned here.</p></div><button onClick={newIntegration}>New integration</button></div>
      <div className={styles.providerList}>{customProviders.length === 0 ? <div className={styles.emptySmall}>No external integrations yet.</div> : customProviders.map((provider) => <div className={styles.providerRow} key={provider.id}><span className={styles.health} data-health={provider.healthStatus} /><div><strong>{provider.name}</strong><small>{provider.protocol.toUpperCase()} · {provider.supportedNetworks.join(", ")} · {provider.supportedAssets.join(", ")}</small></div><div><span className={styles.status} data-status={provider.status}>{provider.status}</span><small>{provider.hasCredential ? `${provider.credentialKind ?? "credential"} ••••••••` : "No credential"}</small></div><div className={styles.rowActions}><button onClick={() => editProvider(provider)}>Edit</button><button disabled={integrationBusy} onClick={() => void toggleProvider(provider)}>{provider.status === "active" ? "Disable" : "Enable"}</button></div></div>)}</div>
      <details className={styles.systemAdapters}><summary>Built-in adapters ({systemProviders.length})</summary>{systemProviders.map((provider) => <div key={provider.id}><strong>{provider.name}</strong><span>{provider.protocol.toUpperCase()} · system-managed · {provider.healthStatus}</span></div>)}</details>
    </section>

    <section className={styles.card}>
      <div className={styles.heading}><span>{editingId ? "Edit integration" : "Add integration"}</span><h2>{editingId ? integration.name || editingId : "Configure an x402 or MPP endpoint"}</h2><p>Test uses the draft endpoint and credential without saving it. Save performs the test again server-side; if it fails, the previous working configuration remains unchanged.</p></div>
      <div className={styles.grid}>
        <label><span>Stable ID</span><input disabled={Boolean(editingId)} value={integration.id} onChange={(e) => setIntegration({ ...integration, id: e.target.value })} placeholder="vendor-search" /></label>
        <label><span>Protocol</span><select disabled={Boolean(editingId)} value={integration.protocol} onChange={(e) => setIntegration({ ...integration, protocol: e.target.value as "x402" | "mpp" })}><option value="x402">x402</option><option value="mpp">MPP</option></select></label>
        <label><span>Name</span><input value={integration.name} onChange={(e) => setIntegration({ ...integration, name: e.target.value })} /></label>
        <label><span>Endpoint</span><input value={integration.endpoint} onChange={(e) => setIntegration({ ...integration, endpoint: e.target.value })} placeholder="https://api.example.com/pay" /></label>
        <label><span>Payee</span><input value={integration.payee} onChange={(e) => setIntegration({ ...integration, payee: e.target.value })} placeholder="Solana payee / provider identity" /></label>
        <label><span>Supported networks</span><input value={integration.supportedNetworks} onChange={(e) => setIntegration({ ...integration, supportedNetworks: e.target.value })} placeholder="devnet" /></label>
        <label><span>Supported assets</span><input value={integration.supportedAssets} onChange={(e) => setIntegration({ ...integration, supportedAssets: e.target.value })} placeholder="USDC or mint" /></label>
        <label><span>Pricing model</span><select value={integration.pricingModel} onChange={(e) => setIntegration({ ...integration, pricingModel: e.target.value as IntegrationDraft["pricingModel"] })}><option value="challenge">Challenge</option><option value="fixed">Fixed</option><option value="metered">Metered</option></select></label>
        <label><span>Fixed price (USDC)</span><input inputMode="decimal" value={integration.fixedPriceUsd} onChange={(e) => setIntegration({ ...integration, fixedPriceUsd: e.target.value })} disabled={integration.pricingModel !== "fixed"} /></label>
        <label><span>Default channel ceiling</span><input inputMode="decimal" value={integration.defaultChannelCeilingUsd} onChange={(e) => setIntegration({ ...integration, defaultChannelCeilingUsd: e.target.value })} /></label>
        <label className={styles.wide}><span>Description</span><textarea value={integration.description} onChange={(e) => setIntegration({ ...integration, description: e.target.value })} /></label>
      </div>
      <div className={styles.credentialBox}><div><strong>Credential</strong><small>{editingId && providers.find((p) => p.id === editingId)?.hasCredential ? "A secret is already stored. Leave the secret blank to keep it unchanged." : "Optional. Secret values are sent only to the server and are never returned."}</small></div><label><span>Type</span><select value={integration.credentialKind} onChange={(e) => setIntegration({ ...integration, credentialKind: e.target.value as IntegrationDraft["credentialKind"], clearCredential: false })}><option value="none">None / keep existing</option><option value="bearer">Bearer</option><option value="api-key">API key</option></select></label>{integration.credentialKind === "api-key" ? <label><span>Header</span><input value={integration.credentialHeaderName} onChange={(e) => setIntegration({ ...integration, credentialHeaderName: e.target.value })} /></label> : null}{integration.credentialKind !== "none" ? <label><span>{editingId ? "Replacement secret" : "Secret"}</span><input type="password" autoComplete="new-password" value={integration.credentialSecret} onChange={(e) => setIntegration({ ...integration, credentialSecret: e.target.value, clearCredential: false })} /></label> : null}{editingId && providers.find((p) => p.id === editingId)?.hasCredential ? <label className={styles.switchRow}><input type="checkbox" checked={integration.clearCredential} onChange={(e) => setIntegration({ ...integration, clearCredential: e.target.checked, credentialSecret: "" })} /><span>Remove stored credential</span></label> : null}</div>
      <div className={styles.integrationActions}><div>{testMessage ? <span className={styles.testSuccess}>✓ {testMessage}</span> : <span>Connection must pass before save.</span>}</div><div><button disabled={testing || integrationBusy} onClick={() => void testIntegration()}>{testing ? "Testing…" : "Test connection"}</button><button className={styles.primary} disabled={!integrationTested || integrationBusy} onClick={() => void saveIntegration()}>{integrationBusy ? "Saving…" : editingId ? "Save verified changes" : "Add verified integration"}</button></div></div>
    </section>
  </div>;
}
