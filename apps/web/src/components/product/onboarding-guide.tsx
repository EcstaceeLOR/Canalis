"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./onboarding-guide.module.css";

type Progress = {
  complete: boolean;
  completedSteps: number;
  totalSteps: number;
  nextStep: "providers" | "policy" | "task" | null;
  steps: Array<{ id: "providers" | "policy" | "task"; label: string; complete: boolean; optional: boolean }>;
};

export function OnboardingGuide() {
  const pathname = usePathname();
  const { session } = useWalletIdentity();
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!session || pathname.startsWith("/onboarding")) {
        if (!cancelled) setProgress(null);
        return;
      }
      try {
        const response = await fetch("/api/onboarding", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { progress: Progress };
        if (!cancelled) setProgress(body.progress);
      } catch {
        // First-run guidance is supplemental; individual workspaces keep their own errors.
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [pathname, session]);

  if (!progress || progress.complete) return null;
  const next = progress.steps.find((step) => step.id === progress.nextStep)?.label ?? "Continue setup";

  return (
    <aside className={styles.guide} aria-label="First-run setup progress">
      <div className={styles.mark} aria-hidden="true">↳</div>
      <div className={styles.copy}>
        <span>Finish workspace setup · {progress.completedSteps}/{progress.totalSteps}</span>
        <strong>{next}</strong>
      </div>
      <Link href="/onboarding">Open setup guide <span aria-hidden="true">→</span></Link>
    </aside>
  );
}
