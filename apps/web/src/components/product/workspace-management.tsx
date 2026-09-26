"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import styles from "./workspace-management.module.css";

type Role = "owner" | "admin" | "operator" | "viewer";
type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  signingWallet: string;
  role: Role;
  memberCount: number;
  isSigningWallet: boolean;
};
type Invitation = {
  id: string;
  workspaceId: string;
  walletAddress: string;
  role: Exclude<Role, "owner">;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAtUnixSeconds: string;
};
type Member = {
  workspaceId: string;
  walletAddress: string;
  role: Role;
  joinedAtUnixSeconds: string;
};
type Overview = {
  workspaces: WorkspaceSummary[];
  invitations: Invitation[];
  current: {
    workspaceId: string;
    name: string;
    role: Role;
    signingWallet: string;
    actorWallet: string;
    isSigningWallet: boolean;
    permissions: string[];
  };
};
type Details = {
  workspace: WorkspaceSummary;
  membership: Member;
  permissions: string[];
  members: Member[];
  invitations: Invitation[];
  signing: { requiredWallet: string; connectedWallet: string; canSign: boolean };
};

function shortWallet(value: string) {
  return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
}

async function api<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { credentials: "same-origin", cache: "no-store", ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function WorkspaceManagement() {
  const { session } = useWalletIdentity();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [inviteWallet, setInviteWallet] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<Role, "owner">>("viewer");

  const load = useCallback(async () => {
    if (!session) {
      setOverview(null);
      setDetails(null);
      return;
    }
    try {
      const next = await api<Overview>("/api/workspaces");
      setOverview(next);
      const detail = await api<Details>(`/api/workspaces/${encodeURIComponent(next.current.workspaceId)}`);
      setDetails(detail);
      setName(detail.workspace.name);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Workspace data could not be loaded.");
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  const canManageMembers = details?.permissions.includes("members:manage") ?? false;
  const canManageSettings = details?.permissions.includes("settings:write") ?? false;
  const pendingInvites = useMemo(() => details?.invitations.filter((item) => item.status === "pending") ?? [], [details]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The workspace action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    if (!details) return;
    await run(async () => {
      await api(`/api/workspaces/${encodeURIComponent(details.workspace.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
    }, "Workspace name updated.");
  }

  async function invite() {
    if (!details) return;
    await run(async () => {
      await api(`/api/workspaces/${encodeURIComponent(details.workspace.id)}/invitations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: inviteWallet, role: inviteRole }),
      });
      setInviteWallet("");
    }, "Invitation created for that wallet.");
  }

  async function switchWorkspace(workspaceId: string) {
    await run(async () => {
      await api("/api/workspaces/current", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
    }, "Workspace context changed.");
  }

  async function accept(invitationId: string) {
    await run(async () => {
      await api(`/api/workspaces/invitations/${encodeURIComponent(invitationId)}/accept`, { method: "POST" });
    }, "Workspace invitation accepted.");
  }

  async function updateRole(member: Member, role: Exclude<Role, "owner">) {
    if (!details) return;
    await run(async () => {
      await api(`/api/workspaces/${encodeURIComponent(details.workspace.id)}/members/${encodeURIComponent(member.walletAddress)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
    }, "Member role updated.");
  }

  async function remove(member: Member) {
    if (!details) return;
    if (!window.confirm(`Remove ${shortWallet(member.walletAddress)} from this workspace?`)) return;
    await run(async () => {
      await api(`/api/workspaces/${encodeURIComponent(details.workspace.id)}/members/${encodeURIComponent(member.walletAddress)}`, { method: "DELETE" });
    }, "Member removed.");
  }

  async function revoke(invitationId: string) {
    if (!details) return;
    await run(async () => {
      await api(`/api/workspaces/${encodeURIComponent(details.workspace.id)}/invitations/${encodeURIComponent(invitationId)}`, { method: "DELETE" });
    }, "Invitation revoked.");
  }

  if (!session) {
    return <section className={styles.empty}><h1>Workspace</h1><p>Connect and sign in with a wallet to manage team access.</p></section>;
  }
  if (!overview || !details) {
    return <section className={styles.empty}><h1>Workspace</h1><p>{error ?? "Loading workspace access…"}</p></section>;
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Team operations</p>
          <h1>{details.workspace.name}</h1>
          <p>Share operational visibility without sharing private keys. Roles are enforced by the API, while signing stays bound to the designated wallet.</p>
        </div>
        <div className={styles.contextCard}>
          <span>Current role</span><strong>{details.membership.role}</strong>
          <span>Signing wallet</span><code>{shortWallet(details.signing.requiredWallet)}</code>
          <span>{details.signing.canSign ? "This connected wallet can authorize signing actions." : "Signing actions require the designated wallet to connect."}</span>
        </div>
      </header>

      {message ? <p className={styles.success} role="status">{message}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>Workspace context</h2><p>Switch between every workspace this wallet belongs to.</p></div></div>
          <div className={styles.workspaceList}>
            {overview.workspaces.map((workspace) => (
              <button
                type="button"
                key={workspace.id}
                disabled={busy || workspace.id === overview.current.workspaceId}
                onClick={() => void switchWorkspace(workspace.id)}
                className={workspace.id === overview.current.workspaceId ? styles.activeWorkspace : ""}
              >
                <span><strong>{workspace.name}</strong><small>{workspace.memberCount} member{workspace.memberCount === 1 ? "" : "s"} · {workspace.role}</small></span>
                <span>{workspace.id === overview.current.workspaceId ? "Current" : "Switch"}</span>
              </button>
            ))}
          </div>
          {canManageSettings ? (
            <div className={styles.inlineForm}>
              <label htmlFor="workspace-name">Workspace name</label>
              <div><input id="workspace-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /><button type="button" disabled={busy || name.trim().length < 2} onClick={() => void rename()}>Save</button></div>
            </div>
          ) : null}
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>Permission model</h2><p>Permissions come from the server-side role matrix.</p></div></div>
          <div className={styles.roles}>
            <div><strong>Owner</strong><span>Full control, member administration, signer authority.</span></div>
            <div><strong>Admin</strong><span>Manages members, providers, policies, settings, integrations, and developer credentials.</span></div>
            <div><strong>Operator</strong><span>Creates and executes tasks and handles operational channel actions, subject to signer requirements.</span></div>
            <div><strong>Viewer</strong><span>Read-only access to operational data and workspace configuration.</span></div>
          </div>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Members</h2><p>Operational access is separate from the wallet that signs transactions.</p></div><span>{details.members.length} total</span></div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Wallet</th><th>Role</th><th>Signing authority</th><th>Actions</th></tr></thead>
            <tbody>
              {details.members.map((member) => {
                const owner = member.role === "owner";
                return (
                  <tr key={member.walletAddress}>
                    <td><code title={member.walletAddress}>{shortWallet(member.walletAddress)}</code></td>
                    <td>
                      {canManageMembers && !owner ? (
                        <select value={member.role} disabled={busy} aria-label={`Role for ${shortWallet(member.walletAddress)}`} onChange={(event) => void updateRole(member, event.target.value as Exclude<Role, "owner">)}>
                          <option value="admin">Admin</option><option value="operator">Operator</option><option value="viewer">Viewer</option>
                        </select>
                      ) : <span className={styles.role}>{member.role}</span>}
                    </td>
                    <td>{member.walletAddress === details.signing.requiredWallet ? "Required signer" : "Operational only"}</td>
                    <td>{canManageMembers && !owner ? <button type="button" className={styles.danger} disabled={busy} onClick={() => void remove(member)}>Remove</button> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>Invite wallet</h2><p>Invitations expire after seven days and are accepted by the invited wallet.</p></div></div>
          {canManageMembers ? (
            <div className={styles.stackForm}>
              <label htmlFor="invite-wallet">Solana wallet address</label>
              <input id="invite-wallet" value={inviteWallet} onChange={(event) => setInviteWallet(event.target.value)} placeholder="Invite a wallet…" />
              <label htmlFor="invite-role">Role</label>
              <select id="invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<Role, "owner">)}><option value="admin">Admin</option><option value="operator">Operator</option><option value="viewer">Viewer</option></select>
              <button type="button" disabled={busy || !inviteWallet.trim()} onClick={() => void invite()}>Create invitation</button>
            </div>
          ) : <p className={styles.muted}>Your role can view members but cannot invite or change them.</p>}
          <div className={styles.invites}>
            {pendingInvites.map((invite) => <div key={invite.id}><span><code>{shortWallet(invite.walletAddress)}</code><small>{invite.role} · pending</small></span>{canManageMembers ? <button type="button" disabled={busy} onClick={() => void revoke(invite.id)}>Revoke</button> : null}</div>)}
            {pendingInvites.length === 0 ? <p className={styles.muted}>No pending invitations for this workspace.</p> : null}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>Your pending invitations</h2><p>Accept access to another signing wallet’s workspace.</p></div></div>
          <div className={styles.invites}>
            {overview.invitations.map((invite) => <div key={invite.id}><span><code>{invite.workspaceId}</code><small>{invite.role} access</small></span><button type="button" disabled={busy} onClick={() => void accept(invite.id)}>Accept</button></div>)}
            {overview.invitations.length === 0 ? <p className={styles.muted}>No invitations waiting for this wallet.</p> : null}
          </div>
        </article>
      </section>
    </div>
  );
}
