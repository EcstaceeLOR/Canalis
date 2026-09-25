import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  migrateDatabase,
  PostgresCanalisRepository,
  PostgresPolicyRepository,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;
const OWNER = "policy-integration-wallet";

const v1Rules = {
  totalCeilingUsd: "1.00",
  maxPerCallUsd: "0.25",
  allowedProviders: ["search", "data"],
  blockedProviders: [],
  providerCapsUsd: { search: "0.60", data: "0.50" },
  durationMinutes: 60,
  allowedNetworks: [],
  allowedMints: ["USDC"],
  allowedProtocols: ["demo"] as const,
};

dbDescribe("reusable policy persistence", () => {
  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    const sql = postgres(databaseUrl!, { max: 1, prepare: false });
    const taskRows = await sql<{ id: string }[]>`SELECT id FROM tasks WHERE owner = ${OWNER}`;
    for (const row of taskRows) await sql`DELETE FROM tasks WHERE id = ${row.id}`;
    await sql`DELETE FROM reusable_policy_definitions WHERE owner_wallet = ${OWNER}`;
    await sql.end({ timeout: 5 });
  });

  it("creates immutable versions and preserves a historical task snapshot", async () => {
    const policies = new PostgresPolicyRepository(databaseUrl!);
    const canalis = new PostgresCanalisRepository(databaseUrl!);

    const created = await policies.create(OWNER, "Research policy", "Versioned guardrails", v1Rules);
    expect(created.latestVersion).toBe(1);
    expect(created.latest.rules.maxPerCallUsd).toBe("0.25");

    await canalis.createTask(
      {
        id: "task_policy_snapshot_integration",
        owner: OWNER,
        agentId: "policy-agent",
        mode: "deterministic",
        budget: { mint: "USDC", totalAtomic: 1_000_000n },
        policy: {
          allowedProviderIds: ["search", "data"],
          blockedProviderIds: [],
          maxPerCallAtomic: 250_000n,
          providerCapsAtomic: { search: 600_000n, data: 500_000n },
          allowedNetworks: [],
          allowedMints: ["USDC"],
          allowedProtocols: ["demo"],
          sourcePolicyId: created.id,
          sourcePolicyVersion: 1,
          sourcePolicyName: created.name,
          overrides: { durationMinutes: 45 },
        },
        status: "draft",
        createdAtUnixSeconds: 1_800_000_000n,
        expiresAtUnixSeconds: 1_800_002_700n,
        updatedAtUnixSeconds: 1_800_000_000n,
      },
      [
        {
          taskId: "task_policy_snapshot_integration",
          providerId: "search",
          programAddress: "program",
          network: "application",
          ceilingAtomic: 500_000n,
          cumulativeAuthorizedAtomic: 0n,
          spentAtomic: 0n,
          status: "reserved",
          createdAtUnixSeconds: 1_800_000_000n,
          updatedAtUnixSeconds: 1_800_000_000n,
        },
        {
          taskId: "task_policy_snapshot_integration",
          providerId: "data",
          programAddress: "program",
          network: "application",
          ceilingAtomic: 500_000n,
          cumulativeAuthorizedAtomic: 0n,
          spentAtomic: 0n,
          status: "reserved",
          createdAtUnixSeconds: 1_800_000_000n,
          updatedAtUnixSeconds: 1_800_000_000n,
        },
      ],
    );

    const updated = await policies.update(created.id, OWNER, {
      rules: { ...v1Rules, totalCeilingUsd: "2.00", maxPerCallUsd: "0.10", providerCapsUsd: { search: "1.50", data: "1.00" } },
    });
    expect(updated.latestVersion).toBe(2);
    expect(updated.latest.rules.totalCeilingUsd).toBe("2.00");

    const oldVersion = await policies.get(created.id, OWNER, 1);
    expect(oldVersion?.latest.version).toBe(1);
    expect(oldVersion?.latest.rules.totalCeilingUsd).toBe("1");
    expect(oldVersion?.latest.rules.maxPerCallUsd).toBe("0.25");

    const task = await canalis.getTask("task_policy_snapshot_integration");
    expect(task?.policy.sourcePolicyId).toBe(created.id);
    expect(task?.policy.sourcePolicyVersion).toBe(1);
    expect(task?.policy.maxPerCallAtomic).toBe(250_000n);
    expect(task?.budget.totalAtomic).toBe(1_000_000n);
    expect(task?.policy.overrides).toEqual({ durationMinutes: 45 });

    const otherWallet = await policies.list("other-wallet", true);
    expect(otherWallet.some((policy) => policy.id === created.id)).toBe(false);

    const duplicate = await policies.duplicate(created.id, OWNER);
    expect(duplicate.id).not.toBe(created.id);
    expect(duplicate.latest.rules.totalCeilingUsd).toBe("2");
    const archived = await policies.archive(created.id, OWNER);
    expect(archived.status).toBe("archived");

    await policies.close();
    await canalis.close();
  });
});
