import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { migrateDatabase, PostgresTransactionRepository } from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;

dbDescribe("transaction explorer persistence", () => {
  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    const sql = postgres(databaseUrl!, { max: 1, prepare: false });
    await sql`DELETE FROM tasks WHERE id IN ('tx-task-a', 'tx-task-b')`;

    await sql`
      INSERT INTO tasks (id, owner, agent_id, mode, mint, budget_atomic, status, created_at_unix, expires_at_unix, updated_at_unix)
      VALUES
        ('tx-task-a', 'wallet-a', 'agent-a', 'deterministic', 'USDC', 1000000, 'completed', 1800000000, 1800003600, 1800000300),
        ('tx-task-b', 'wallet-b', 'agent-b', 'deterministic', 'USDC', 1000000, 'completed', 1800000000, 1800003600, 1800000300)
    `;
    await sql`
      INSERT INTO policies (task_id, allowed_provider_ids, max_per_call_atomic, provider_caps_atomic)
      VALUES
        ('tx-task-a', '["search"]'::jsonb, 250000, '{}'::jsonb),
        ('tx-task-b', '["search"]'::jsonb, 250000, '{}'::jsonb)
    `;
    await sql`
      INSERT INTO task_workspace_metadata (task_id, name, description, policy_id)
      VALUES
        ('tx-task-a', 'Audit task A', '', 'inline-bounded'),
        ('tx-task-b', 'Audit task B', '', 'inline-bounded')
      ON CONFLICT (task_id) DO UPDATE SET name = EXCLUDED.name
    `;
    await sql`
      INSERT INTO channels (
        task_id, provider_id, program_address, network, channel_address, ceiling_atomic,
        cumulative_authorized_atomic, spent_atomic, status, open_transaction_signature,
        settle_transaction_signature, distribution_transaction_signature, refund_transaction_signature,
        created_at_unix, updated_at_unix
      ) VALUES (
        'tx-task-a', 'search', 'program-a', 'devnet', 'channel-a', 250000,
        50000, 50000, 'recovered', 'open-sig-a', 'settle-sig-a', 'distribution-sig-a', 'refund-sig-a',
        1800000010, 1800000300
      )
    `;
    await sql`
      INSERT INTO flows (
        id, task_id, provider_id, request_id, status, quoted_amount_atomic,
        previous_cumulative_atomic, next_cumulative_atomic, authorization_id,
        payment_reference, created_at_unix
      ) VALUES
        ('flow-ok-a', 'tx-task-a', 'search', 'request-ok-a', 'fulfilled', 50000, 0, 50000, 'auth-a', 'payref-a', 1800000100),
        ('flow-reject-a', 'tx-task-a', 'search', 'request-reject-a', 'rejected', 300000, 50000, 50000, NULL, NULL, 1800000200)
    `;
    await sql`
      INSERT INTO receipts (
        flow_id, task_id, provider_id, request_id, mint, price_atomic, protocol,
        authorization_id, payment_reference, response_hash, timestamp_unix, protocol_metadata
      ) VALUES (
        'flow-ok-a', 'tx-task-a', 'search', 'request-ok-a', 'USDC', 50000, 'demo',
        'auth-a', 'payref-a', 'hash-a', 1800000101, '{"source":"integration"}'::jsonb
      )
    `;
    await sql.end({ timeout: 5 });
  });

  it("normalizes receipts and channel lifecycle while preserving wallet isolation", async () => {
    const repository = new PostgresTransactionRepository(databaseUrl!);
    const result = await repository.list({ owner: "wallet-a", page: 1, pageSize: 25, sort: "newest" });

    expect(result.total).toBe(6);
    expect(result.records.some((record) => record.kind === "authorization" && record.responseHash === "hash-a")).toBe(true);
    expect(result.records.some((record) => record.kind === "rejection")).toBe(true);
    expect(result.records.some((record) => record.kind === "channel_open" && record.signature === "open-sig-a")).toBe(true);
    expect(result.records.some((record) => record.kind === "settlement" && record.signature === "settle-sig-a")).toBe(true);
    expect(result.records.some((record) => record.kind === "distribution" && record.signature === "distribution-sig-a")).toBe(true);
    expect(result.records.some((record) => record.kind === "recovery" && record.signature === "refund-sig-a")).toBe(true);
    expect(result.summary.authorizationAtomic).toBe("50000");
    expect(result.summary.settledAtomic).toBe("50000");
    expect(result.summary.recoveredAtomic).toBe("200000");
    expect(result.summary.failedCount).toBe(1);
    expect(result.summary.onchainCount).toBe(4);

    const search = await repository.list({ owner: "wallet-a", search: "hash-a", page: 1, pageSize: 25, sort: "newest" });
    expect(search.total).toBe(1);
    expect(search.records[0]?.kind).toBe("authorization");

    const detail = await repository.getById("authorization:flow-ok-a", "wallet-a");
    expect(detail?.taskName).toBe("Audit task A");
    await expect(repository.getById("authorization:flow-ok-a", "wallet-b")).resolves.toBeNull();

    const exported = await repository.exportAll({ owner: "wallet-a", page: 1, pageSize: 25, sort: "oldest" });
    expect(exported.records).toHaveLength(6);
    expect(exported.summary.authorizationAtomic).toBe("50000");

    await repository.close();
  });
});
