"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./onboarding-workspace.module.css";

type StepId = "providers" | "policy" | "task";
type OnboardingPayload = {
  progress: {
    complete: boolean;
    completedSteps: number;
    totalSteps: number;
    nextStep: StepId | null;
    steps: Array<{ id: StepId; label: string; complete: boolean; optional: boolean }>;
  };
  inventory: {
    runtimeReadyProviders: number;
    customProviders: number;
    verifiedExternalProviders: number;
    policies: number;
    tasks: number;
  };
  runtime: {
    environment: "local" | "devnet" | "mainnet";
    solanaNetwork: "localnet" | "devnet" | "mainnet-beta";
    defaultAssetSymbol: string;
  };
};

async function responseMessage(response: Response) {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

const destinations: Record<StepId, { href: string; cta: string }> = {
  providers: { href: "/providers", cta: "Review providers" },
  policy: { href: "/policies", cta: "Create policy" },
  task: { href: "/tasks/new", cta: "Create task" },
};

export function OnboardingWorkspace() {
  const { session, status: walletStatus } = useWalletIdentity();
  const [payload, setPayload] = useState<OnboardingPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session) {
      setPayload(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/onboarding", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setPayload(await response.json() as OnboardingPayload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load onboarding progress.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const progress = useMemo(() => payload
    ? Math.round((payload.progress.completedSteps / payload.progress.totalSteps) * 100)
    : 0, [payload]);

  if (!session) {
    return (
      <section className={styles.connect}>
        <span aria-hidden="true">◎</span>
        <div>
          <p className={styles.eyebrow}>First-run setup</p>
          <h1>Connect the wallet that will own this workspace</h1>
          <p>Provider configuration, policies, tasks, receipts, and recovery history are wallet-scoped. {walletStatus === "loading" ? "Checking your existing session…" : "Use Connect wallet in the top bar to begin."}</p>
        </div>
      </section>
    );
  }

  if (loading && !payload) {
    return <div className={styles.loading} aria-busy="true" aria-label="Loading setup progress"><i /><i /><i /></div>;
  }

  if (error && !payload) {
    return <div className={styles.error} role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div>;
  }

  if (!payload) return null;

  const { inventory, runtime } = payload;
  const mainnetBlocked = runtime.environment === "mainnet";

  return (
    <div className={styles.workspace}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Get started</p>
          <h1>{payload.progress.complete ? "Your Canalis workspace is ready." : "Configure your first governed agent task."}</h1>
          <p>Use a runtime-ready provider path, define how the agent may spend, then create the task that owns the budget and audit trail.</p>
        </div>
        <div className={styles.progressCard}>
          <div><span>Setup progress</span><strong>{payload.progress.completedSteps}/{payload.progress.totalSteps}</strong></div>
          <div className={styles.progressTrack} aria-label={`${progress}% of onboarding steps complete`}><i style={{ width: `${progress}%` }} /></div>
          <small>{payload.progress.complete ? "First task created" : "Progress is derived from persisted wallet data"}</small>
        </div>
      </header>

      {error ? <div className={styles.error} role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div> : null}

      <section className={styles.runtime} aria-label="Runtime context">
        <div><span>Environment</span><strong>{runtime.environment}</strong></div>
        <div><span>Solana network</span><strong>{runtime.solanaNetwork}</strong></div>
        <div><span>Default asset</span><strong>{runtime.defaultAssetSymbol}</strong></div>
        <p>{mainnetBlocked
          ? "Mainnet task creation is intentionally blocked until a mainnet-capable non-custodial signer/runtime is connected. Change the workspace environment before creating a task."
          : "Built-in provider roles are execution-ready in the supported local/devnet paths. External x402/MPP integrations may be configured and verified, but autonomous execution stays gated until the required non-custodial signer/session runtime is connected."}</p>
      </section>

      <section className={styles.steps} aria-label="Setup steps">
        <SetupStep
          number="01"
          complete={inventory.runtimeReadyProviders > 0}
          title="Review provider readiness"
          description={`${inventory.runtimeReadyProviders} runtime-ready provider path${inventory.runtimeReadyProviders === 1 ? "" : "s"} available. ${inventory.customProviders} custom integration${inventory.customProviders === 1 ? "" : "s"} configured; ${inventory.verifiedExternalProviders} external integration${inventory.verifiedExternalProviders === 1 ? " is" : "s are"} protocol-verified.`}
          footnote="Verification proves the endpoint advertises compatible payment metadata; it does not create or expose a custodial signing key."
          step="providers"
        />
        <SetupStep
          number="02"
          complete={inventory.policies > 0}
          optional
          title="Create a reusable spending policy"
          description={`${inventory.policies} reusable polic${inventory.policies === 1 ? "y" : "ies"} saved. Policies keep provider allowlists, total ceilings, per-call caps, assets, networks, and protocols consistent across tasks.`}
          footnote="Optional for the first task: the task composer can also create an inline bounded policy snapshot."
          step="policy"
        />
        <SetupStep
          number="03"
          complete={inventory.tasks > 0}
          title="Create your first governed task"
          description={`${inventory.tasks} task${inventory.tasks === 1 ? "" : "s"} currently persisted for this wallet. The task owns the approved budget, policy snapshot, provider routes, receipts, and terminal recovery state.`}
          footnote={mainnetBlocked ? "Switch away from the mainnet profile before task creation; this deployment does not pretend to have a mainnet signer." : "Start with a bounded budget and only the provider routes the agent actually needs."}
          step="task"
        />
      </section>

      <section className={styles.finish}>
        <div>
          <span>{payload.progress.complete ? "Setup complete" : "Next recommended action"}</span>
          <strong>{payload.progress.complete ? "Inspect the live workspace" : payload.progress.steps.find((step) => step.id === payload.progress.nextStep)?.label ?? "Create your task"}</strong>
        </div>
        <div>
          {payload.progress.complete
            ? <Link className={styles.primary} href="/dashboard">Open dashboard →</Link>
            : payload.progress.nextStep
              ? <Link className={styles.primary} href={destinations[payload.progress.nextStep].href}>{destinations[payload.progress.nextStep].cta} →</Link>
              : null}
          <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh progress"}</button>
        </div>
      </section>
    </div>
  );
}

function SetupStep({
  number,
  title,
  description,
  footnote,
  complete,
  optional = false,
  step,
}: {
  number: string;
  title: string;
  description: string;
  footnote: string;
  complete: boolean;
  optional?: boolean;
  step: StepId;
}) {
  const destination = destinations[step];
  return (
    <article className={`${styles.step} ${complete ? styles.complete : ""}`}>
      <div className={styles.stepTop}><span>{number}</span><b>{complete ? "Complete" : optional ? "Recommended" : "Required"}</b></div>
      <h2>{title}</h2>
      <p>{description}</p>
      <small>{footnote}</small>
      <Link href={destination.href}>{complete ? "Review" : destination.cta} <span>→</span></Link>
    </article>
  );
}
