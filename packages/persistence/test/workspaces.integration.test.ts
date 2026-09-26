import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  migrateDatabase,
  PostgresTaskWorkspaceRepository,
  PostgresWorkspaceRepository,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;

dbDescribe("team workspace persistence", () => {
  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
  });

  it("supports multi-workspace membership, role changes, owner protection, and auditable membership changes", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const ownerWallet = `wallet_owner_${suffix}`;
    const memberWallet = `wallet_member_${suffix}`;
    const strangerWallet = `wallet_stranger_${suffix}`;
    const repo = new PostgresWorkspaceRepository(databaseUrl!);

    const ownerWorkspace = await repo.ensurePersonalWorkspace(ownerWallet);
    const memberWorkspace = await repo.ensurePersonalWorkspace(memberWallet);
    expect(ownerWorkspace.id).not.toBe(memberWorkspace.id);

    const invitation = await repo.createInvitation({
      id: `invite_${suffix}`,
      workspaceId: ownerWorkspace.id,
      signingWallet: ownerWallet,
      walletAddress: memberWallet,
      role: "operator",
      invitedByWallet: ownerWallet,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(invitation.role).toBe("operator");

    const accepted = await repo.acceptInvitation(invitation.id, memberWallet);
    expect(accepted?.role).toBe("operator");
    const memberships = await repo.listForWallet(memberWallet);
    expect(memberships.map((item) => item.id)).toEqual(expect.arrayContaining([memberWorkspace.id, ownerWorkspace.id]));
    expect(await repo.getForMember(ownerWorkspace.id, strangerWallet)).toBeNull();

    const changed = await repo.updateMemberRole({
      workspaceId: ownerWorkspace.id,
      signingWallet: ownerWallet,
      targetWallet: memberWallet,
      role: "viewer",
      actorWallet: ownerWallet,
    });
    expect(changed?.role).toBe("viewer");
    expect(await repo.updateMemberRole({
      workspaceId: ownerWorkspace.id,
      signingWallet: ownerWallet,
      targetWallet: ownerWallet,
      role: "viewer",
      actorWallet: ownerWallet,
    })).toBeNull();

    const sql = postgres(databaseUrl!, { max: 1, prepare: false });
    const audit = await sql<{ actor_wallet: string; workspace_id: string; resource_type: string }[]>`
      SELECT actor_wallet, workspace_id, resource_type
      FROM audit_events
      WHERE workspace_id = ${ownerWorkspace.id} AND resource_type = 'workspace_member'
      ORDER BY id ASC
    `;
    expect(audit.some((event) => event.actor_wallet === memberWallet)).toBe(true);
    expect(audit.some((event) => event.actor_wallet === ownerWallet)).toBe(true);
    await sql.end({ timeout: 5 });
    await repo.close();
  });

  it("stamps tenant-owned rows with workspace IDs and keeps task reads isolated by signing workspace", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const walletA = `wallet_tenant_a_${suffix}`;
    const walletB = `wallet_tenant_b_${suffix}`;
    const workspaceRepo = new PostgresWorkspaceRepository(databaseUrl!);
    const workspaceA = await workspaceRepo.ensurePersonalWorkspace(walletA);
    const workspaceB = await workspaceRepo.ensurePersonalWorkspace(walletB);
    const sql = postgres(databaseUrl!, { max: 1, prepare: false });
    const now = Math.floor(Date.now() / 1000);
    const taskA = `task_a_${suffix}`;
    const taskB = `task_b_${suffix}`;

    for (const [id, owner] of [[taskA, walletA], [taskB, walletB]] as const) {
      await sql`
        INSERT INTO tasks (id, owner, agent_id, mode, mint, budget_atomic, status, created_at_unix, expires_at_unix, updated_at_unix)
        VALUES (${id}, ${owner}, 'agent', 'deterministic', 'USDC', 1000000, 'active', ${now}, ${now + 3600}, ${now})
      `;
      await sql`
        INSERT INTO policies (task_id, allowed_provider_ids, provider_caps_atomic)
        VALUES (${id}, '[]'::jsonb, '{}'::jsonb)
      `;
    }

    const stamped = await sql<{ id: string; workspace_id: string }[]>`
      SELECT id, workspace_id FROM tasks WHERE id IN (${taskA}, ${taskB}) ORDER BY id
    `;
    expect(stamped.find((row) => row.id === taskA)?.workspace_id).toBe(workspaceA.id);
    expect(stamped.find((row) => row.id === taskB)?.workspace_id).toBe(workspaceB.id);

    const tasks = new PostgresTaskWorkspaceRepository(databaseUrl!);
    const visibleA = await tasks.listTasks({ owner: walletA, sort: "updated_desc", page: 1, pageSize: 20 });
    const visibleB = await tasks.listTasks({ owner: walletB, sort: "updated_desc", page: 1, pageSize: 20 });
    expect(visibleA.tasks.some((task) => task.id === taskA)).toBe(true);
    expect(visibleA.tasks.some((task) => task.id === taskB)).toBe(false);
    expect(visibleB.tasks.some((task) => task.id === taskB)).toBe(true);
    expect(visibleB.tasks.some((task) => task.id === taskA)).toBe(false);

    await tasks.close();
    await sql.end({ timeout: 5 });
    await workspaceRepo.close();
  });
});
