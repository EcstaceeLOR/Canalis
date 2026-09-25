"use client";

import { useEffect, useState } from "react";
import styles from "./product-status.module.css";

type Health = {
  status: "ok" | "degraded";
  release: {
    version: string;
    environment: string;
    commit: string | null;
  };
  checks: {
    web: string;
    durableStorage: string;
  };
};

export function ProductStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const body = await response.json() as Health;
        if (!cancelled) setHealth(body);
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  if (unavailable) {
    return <span className={`${styles.status} ${styles.degraded}`}><i />Status unavailable</span>;
  }
  if (!health) {
    return <span className={styles.status} aria-busy="true"><i />Checking production…</span>;
  }

  const operational = health.status === "ok";
  return (
    <a className={`${styles.status} ${operational ? styles.ok : styles.degraded}`} href="/api/health" aria-label={`Production status ${operational ? "operational" : "degraded"}. Release ${health.release.version}.`}>
      <i />
      <span>{operational ? "Production operational" : "Production needs configuration"}</span>
      <b>{health.release.version}</b>
    </a>
  );
}
