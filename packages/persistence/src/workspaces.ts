import type {
  WorkspaceInvitationRecord,
  WorkspaceMembershipRecord,
  WorkspaceRecord,
  WorkspaceRole,
  WorkspaceSummary,
} from "@canalis/application";
import postgres, { type Sql } from "postgres";

function unix(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return String(Math.floor(date.getTime() / 1000));
}

function workspace(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    signingWallet: String(row.signing_wallet),
    createdByWallet: String(row.created_by_wallet),
    createdAtUnixSeconds: unix(row.created_at),
    updatedAtUnixSeconds: unix(row.updated_at),
  };
}

function membership(row: Record<string, unknown>): WorkspaceMembershipRecord {
  return {
    workspaceId: String(row.workspace_id),
    walletAddress: String(row.wallet_address),
    role: String(row.role) as WorkspaceRole,
    addedByWallet: String(row.added_by_wallet),
    joinedAtUnixSeconds: unix(row.joined_at),
  };
}

function invitation(row: Record<string, unknown>): WorkspaceInvitationRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    walletAddress: String(row.wallet_address),
    role: String(row.role) as WorkspaceInvitationRecord["role"],
    invitedByWallet: String(row.invited_by_wallet),
    status: String(row.status) as WorkspaceInvitationRecord["status"],
    expiresAtUnixSeconds: unix(row.expires_at),
    createdAtUnixSeconds: unix(row.created_at),
    updatedAtUnixSeconds: unix(row.updated_at),
  };
}

export class PostgresWorkspaceRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 5, prepare: false });
  }

  async ensurePersonalWorkspace(walletAddress: string): Promise<WorkspaceRecord> {
    const id = `ws_${await this.walletDigest(walletAddress)}`;
    const slug = `wallet-${await this.walletDigest(walletAddress)}`;
    const name = `Workspace ${walletAddress.slice(0, 6)}`;
    await this.sql`
      INSERT INTO workspaces (id, name, slug, signing_wallet, created_by_wallet)
      VALUES (${id}, ${name}, ${slug}, ${walletAddress}, ${walletAddress})
      ON CONFLICT (signing_wallet) DO NOTHING
    `;
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM workspaces WHERE signing_wallet = ${walletAddress} LIMIT 1
    `;
    const current = rows[0];
    if (!current) throw new Error("Workspace could not be initialized.");
    await this.sql`
      INSERT INTO workspace_members (workspace_id, wallet_address, role, added_by_wallet)
      VALUES (${String(current.id)}, ${walletAddress}, 'owner', ${walletAddress})
      ON CONFLICT (workspace_id, wallet_address) DO NOTHING
    `;
    return workspace(current);
  }

  private async walletDigest(walletAddress: string): Promise<string> {
    const rows = await this.sql<{ digest: string }[]>`SELECT substr(md5(${walletAddress}), 1, 24) AS digest`;
    return rows[0]?.digest ?? walletAddress.slice(0, 24);
  }

  async listForWallet(walletAddress: string): Promise<WorkspaceSummary[]> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT w.*, m.role,
        (SELECT COUNT(*)::int FROM workspace_members all_members WHERE all_members.workspace_id = w.id) AS member_count
      FROM workspace_members m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.wallet_address = ${walletAddress}
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'operator' THEN 2 ELSE 3 END, w.name ASC
    `;
    return rows.map((row) => ({
      ...workspace(row),
      role: String(row.role) as WorkspaceRole,
      memberCount: Number(row.member_count ?? 0),
      isSigningWallet: String(row.signing_wallet) === walletAddress,
    }));
  }

  async getForMember(workspaceId: string, walletAddress: string): Promise<{ workspace: WorkspaceRecord; membership: WorkspaceMembershipRecord } | null> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT w.*, m.workspace_id, m.wallet_address, m.role, m.added_by_wallet, m.joined_at
      FROM workspace_members m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = ${workspaceId} AND m.wallet_address = ${walletAddress}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? { workspace: workspace(row), membership: membership(row) } : null;
  }

  async rename(workspaceId: string, actorWallet: string, name: string): Promise<WorkspaceRecord | null> {
    const beforeRows = await this.sql<Record<string, unknown>[]>`SELECT * FROM workspaces WHERE id = ${workspaceId} LIMIT 1`;
    if (!beforeRows[0]) return null;
    const rows = await this.sql<Record<string, unknown>[]>`
      UPDATE workspaces SET name = ${name}, updated_at = NOW() WHERE id = ${workspaceId} RETURNING *
    `;
    const updated = rows[0];
    if (!updated) return null;
    await this.audit(String(updated.signing_wallet), actorWallet, workspaceId, "workspace", workspaceId, "update", beforeRows[0], updated);
    return workspace(updated);
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMembershipRecord[]> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM workspace_members WHERE workspace_id = ${workspaceId}
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'operator' THEN 2 ELSE 3 END, joined_at ASC
    `;
    return rows.map(membership);
  }

  async listInvitations(workspaceId: string): Promise<WorkspaceInvitationRecord[]> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM workspace_invitations WHERE workspace_id = ${workspaceId}
      ORDER BY created_at DESC
    `;
    return rows.map(invitation);
  }

  async listPendingInvitationsForWallet(walletAddress: string): Promise<WorkspaceInvitationRecord[]> {
    await this.sql`
      UPDATE workspace_invitations SET status = 'expired', updated_at = NOW()
      WHERE wallet_address = ${walletAddress} AND status = 'pending' AND expires_at <= NOW()
    `;
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM workspace_invitations
      WHERE wallet_address = ${walletAddress} AND status = 'pending' AND expires_at > NOW()
      ORDER BY created_at DESC
    `;
    return rows.map(invitation);
  }

  async createInvitation(input: {
    id: string;
    workspaceId: string;
    signingWallet: string;
    walletAddress: string;
    role: Exclude<WorkspaceRole, "owner">;
    invitedByWallet: string;
    expiresAt: Date;
  }): Promise<WorkspaceInvitationRecord> {
    const existingMember = await this.sql<{ one: number }[]>`
      SELECT 1 AS one FROM workspace_members
      WHERE workspace_id = ${input.workspaceId} AND wallet_address = ${input.walletAddress}
      LIMIT 1
    `;
    if (existingMember.length) throw new Error("WORKSPACE_MEMBER_EXISTS");
    const rows = await this.sql<Record<string, unknown>[]>`
      INSERT INTO workspace_invitations (id, workspace_id, wallet_address, role, invited_by_wallet, expires_at)
      VALUES (${input.id}, ${input.workspaceId}, ${input.walletAddress}, ${input.role}, ${input.invitedByWallet}, ${input.expiresAt})
      RETURNING *
    `;
    const created = rows[0]!;
    await this.audit(input.signingWallet, input.invitedByWallet, input.workspaceId, "workspace_invitation", input.id, "insert", null, created);
    return invitation(created);
  }

  async acceptInvitation(invitationId: string, walletAddress: string): Promise<WorkspaceMembershipRecord | null> {
    return this.sql.begin(async (tx) => {
      const invites = await tx<Record<string, unknown>[]>`
        SELECT i.*, w.signing_wallet
        FROM workspace_invitations i
        JOIN workspaces w ON w.id = i.workspace_id
        WHERE i.id = ${invitationId} AND i.wallet_address = ${walletAddress}
          AND i.status = 'pending' AND i.expires_at > NOW()
        FOR UPDATE
      `;
      const invite = invites[0];
      if (!invite) return null;
      const memberRows = await tx<Record<string, unknown>[]>`
        INSERT INTO workspace_members (workspace_id, wallet_address, role, added_by_wallet)
        VALUES (${String(invite.workspace_id)}, ${walletAddress}, ${String(invite.role)}, ${String(invite.invited_by_wallet)})
        ON CONFLICT (workspace_id, wallet_address) DO UPDATE SET role = EXCLUDED.role
        RETURNING *
      `;
      await tx`UPDATE workspace_invitations SET status = 'accepted', updated_at = NOW() WHERE id = ${invitationId}`;
      const member = memberRows[0]!;
      await tx`
        INSERT INTO audit_events (owner_wallet, actor_wallet, workspace_id, resource_type, resource_id, action, before_state, after_state)
        VALUES (
          ${String(invite.signing_wallet)}, ${walletAddress}, ${String(invite.workspace_id)},
          'workspace_member', ${walletAddress}, 'insert', NULL, CAST(${JSON.stringify(member)} AS jsonb)
        )
      `;
      return membership(member);
    });
  }

  async updateMemberRole(input: {
    workspaceId: string;
    signingWallet: string;
    targetWallet: string;
    role: Exclude<WorkspaceRole, "owner">;
    actorWallet: string;
  }): Promise<WorkspaceMembershipRecord | null> {
    const beforeRows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM workspace_members WHERE workspace_id = ${input.workspaceId} AND wallet_address = ${input.targetWallet} LIMIT 1
    `;
    const before = beforeRows[0];
    if (!before || String(before.role) === "owner") return null;
    const rows = await this.sql<Record<string, unknown>[]>`
      UPDATE workspace_members SET role = ${input.role}
      WHERE workspace_id = ${input.workspaceId} AND wallet_address = ${input.targetWallet} AND role <> 'owner'
      RETURNING *
    `;
    const updated = rows[0];
    if (!updated) return null;
    await this.audit(input.signingWallet, input.actorWallet, input.workspaceId, "workspace_member", input.targetWallet, "update", before, updated);
    return membership(updated);
  }

  async removeMember(input: {
    workspaceId: string;
    signingWallet: string;
    targetWallet: string;
    actorWallet: string;
  }): Promise<boolean> {
    const rows = await this.sql<Record<string, unknown>[]>`
      DELETE FROM workspace_members
      WHERE workspace_id = ${input.workspaceId} AND wallet_address = ${input.targetWallet} AND role <> 'owner'
      RETURNING *
    `;
    const removed = rows[0];
    if (!removed) return false;
    await this.audit(input.signingWallet, input.actorWallet, input.workspaceId, "workspace_member", input.targetWallet, "delete", removed, null);
    return true;
  }

  async revokeInvitation(input: { invitationId: string; workspaceId: string; signingWallet: string; actorWallet: string }): Promise<boolean> {
    const beforeRows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM workspace_invitations WHERE id = ${input.invitationId} AND workspace_id = ${input.workspaceId} AND status = 'pending' LIMIT 1
    `;
    const before = beforeRows[0];
    if (!before) return false;
    const rows = await this.sql<Record<string, unknown>[]>`
      UPDATE workspace_invitations SET status = 'revoked', updated_at = NOW()
      WHERE id = ${input.invitationId} AND workspace_id = ${input.workspaceId} AND status = 'pending'
      RETURNING *
    `;
    const updated = rows[0];
    if (!updated) return false;
    await this.audit(input.signingWallet, input.actorWallet, input.workspaceId, "workspace_invitation", input.invitationId, "update", before, updated);
    return true;
  }

  private async audit(
    ownerWallet: string,
    actorWallet: string,
    workspaceId: string,
    resourceType: string,
    resourceId: string,
    action: "insert" | "update" | "delete",
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Promise<void> {
    await this.sql`
      INSERT INTO audit_events (owner_wallet, actor_wallet, workspace_id, resource_type, resource_id, action, before_state, after_state)
      VALUES (
        ${ownerWallet}, ${actorWallet}, ${workspaceId}, ${resourceType}, ${resourceId}, ${action},
        ${before ? this.sql.unsafe(`CAST('${JSON.stringify(before).replaceAll("'", "''")}' AS jsonb)`) : null},
        ${after ? this.sql.unsafe(`CAST('${JSON.stringify(after).replaceAll("'", "''")}' AS jsonb)`) : null}
      )
    `;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
