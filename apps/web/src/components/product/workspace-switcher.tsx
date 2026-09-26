"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./workspace-switcher.module.css";

type WorkspaceSummary = {
  id: string;
  name: string;
  role: "owner" | "admin" | "operator" | "viewer";
  signingWallet: string;
  memberCount: number;
};

type WorkspacePayload = {
  workspaces: WorkspaceSummary[];
  current: {
    workspaceId: string;
    name: string;
    role: WorkspaceSummary["role"];
    signingWallet: string;
    actorWallet: string;
    isSigningWallet: boolean;
  };
};

export function WorkspaceSwitcher() {
  const { session } = useWalletIdentity();
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session) {
      setData(null);
      return;
    }
    try {
      const response = await fetch("/api/workspaces", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return;
      setData(await response.json() as WorkspacePayload);
    } catch {
      // The rest of the product keeps working with the authenticated wallet if workspace metadata is temporarily unavailable.
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  async function switchWorkspace(workspaceId: string) {
    if (!data || workspaceId === data.current.workspaceId) return;
    setBusy(true);
    try {
      const response = await fetch("/api/workspaces/current", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!response.ok) return;
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  if (!session || !data) return null;

  return (
    <div className={styles.switcher}>
      <div className={styles.labelRow}>
        <span>Workspace</span>
        <Link href="/workspace">Manage</Link>
      </div>
      <select
        aria-label="Current workspace"
        value={data.current.workspaceId}
        disabled={busy}
        onChange={(event) => void switchWorkspace(event.target.value)}
      >
        {data.workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.role}</option>
        ))}
      </select>
      <div className={styles.meta}>
        <span>{data.current.isSigningWallet ? "Signing wallet connected" : `Signer ${data.current.signingWallet.slice(0, 6)}…${data.current.signingWallet.slice(-4)}`}</span>
        <span>{data.current.role}</span>
      </div>
    </div>
  );
}
