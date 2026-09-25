import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import { migrateDatabase } from "../src/migrate.js";
import { PostgresLiveChannelRepository } from "../src/live-channels.js";
import { PostgresSecurityRepository } from "../src/security.js";
import { PostgresTaskWorkspaceRepository } from "../src/tasks.js";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;

dbDescribe("production hardening persistence", () => {
  let sql: Sql;
  let security: PostgresSecurityRepository;
  let tasks: PostgresTaskWorkspaceRepository;
  let liveChannels: PostgresLiveChannelRepository;
  const stamp = Date.now();
  const owner = `security-owner-${stamp}`;
  const otherOwner = `${owner}-other`;
  const providerId = `security-provider-${stamp}`;
  const taskId = `security-task-${stamp}`;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    sql = postgres(databaseUrl!, { max: 4, prepare: false });
    security = new PostgresSecurityRepository(databaseUrl!);
    tasks = new PostgresTaskWorkspaceRepository(databaseUrl!);
    liveChannels = new PostgresLiveChannelRepository(databaseUrl!);
  });

  afterAll(async () => {
    await security.close();
    await tasks.close();
    await liveChannels.close();
    await sql.end({ timeout: 5 });
  });

  it("collapses concurrent duplicate idempotency claims and replays the completed response", async () => {
    const request = {
      ownerWallet: owner,
      operation: "task.execute",
      idempotencyKey: `idem-${stamp}`,
      requestHash: `hash-${stamp}`,
    };
    const [a, b] = await Promise.all([
      security.beginIdempotency(request),
      security.beginIdempotency(request),
    ]);
    expect([a.status, b.status].sort()).toEqual(["acquired", "in-progress"]);

    await security.completeIdempotency({
      ...request,
      responseStatus: 200,
      responseBody: '{"ok":true}',
      responseContentType: "application/json",
    });
    const replay = await security.beginIdempotency(request);
    expect(replay).toMatchObject({ status: "replay", responseStatus: 200, responseBody: '{"ok":true}' });
    expect(await security.beginIdempotency({ ...request, requestHash: "different-hash" })).toEqual({ status: "conflict" });
    expect((await security.beginIdempotency({ ...request, ownerWallet: otherOwner })).status).toBe("acquired");
  });

  it("serializes resource mutations even when callers use different retry keys", async () => {
    const resourceKey = `task:${taskId}:mutation`;
    expect(await security.acquireMutationLock({
      resourceKey,
      ownerWallet: owner,
      operation: "task.execute",
      holderKey: "holder-a",
    })).toBe(true);
    expect(await security.acquireMutationLock({
      resourceKey,
      ownerWallet: owner,
      operation: "task.lifecycle",
      holderKey: "holder-b",
    })).toBe(false);
    await security.releaseMutationLock(resourceKey, "holder-a");
    expect(await security.acquireMutationLock({
      resourceKey,
      ownerWallet: owner,
      operation: "task.lifecycle",
      holderKey: "holder-b",
    })).toBe(true);
    await security.releaseMutationLock(resourceKey, "holder-b");
  });

  it("enforces fixed-window rate limits", async () => {
    const scopeKey = `security-rate-${stamp}`;
    expect((await security.consumeRateLimit({ scopeKey, limit: 2, windowSeconds: 60 })).allowed).toBe(true);
    expect((await security.consumeRateLimit({ scopeKey, limit: 2, windowSeconds: 60 })).allowed).toBe(true);
    const blocked = await security.consumeRateLimit({ scopeKey, limit: 2, windowSeconds: 60 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(3);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("uses compare-and-set task transitions so a stale concurrent mutation cannot win", async () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    await sql`
      INSERT INTO tasks (id, owner, agent_id, mode, mint, budget_atomic, status, created_at_unix, expires_at_unix, updated_at_unix)
      VALUES (${taskId}, ${owner}, 'security-agent', 'deterministic', 'USDC', 1000000, 'active', ${now.toString()}, ${(now + 600n).toString()}, ${now.toString()})
    `;

    const [cancelled, completed] = await Promise.all([
      tasks.setStatus(taskId, owner, "cancelled", now + 1n, undefined, ["active"]),
      tasks.setStatus(taskId, owner, "completed", now + 1n, undefined, ["active"]),
    ]);
    expect([cancelled, completed].filter(Boolean)).toHaveLength(1);
    expect(await tasks.setStatus(taskId, otherOwner, "cancelled", now + 2n, undefined, ["active", "completed"])).toBe(false);
  });

  it("prevents duplicate settlement and recovery terminal attempts", async () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    await sql`
      INSERT INTO channels (
        task_id, provider_id, program_address, network, channel_address,
        ceiling_atomic, cumulative_authorized_atomic, spent_atomic, status,
        recovery_state, created_at_unix, updated_at_unix
      ) VALUES (
        ${taskId}, 'search', 'program', 'solana:devnet', 'security-channel',
        1000000, 250000, 250000, 'open', '{}'::jsonb, ${now.toString()}, ${now.toString()}
      )
    `;

    const input = {
      taskId,
      providerId: "search",
      cumulativeAmountAtomic: 250000n,
      startedAtUnixSeconds: now + 1n,
    };
    const [first, second] = await Promise.all([
      liveChannels.beginFinalization(input),
      liveChannels.beginFinalization(input),
    ]);
    expect([first, second].sort()).toEqual(["acquired", "busy"]);

    await Promise.all([
      liveChannels.recordSettlement({
        taskId,
        providerId: "search",
        cumulativeAmountAtomic: 250000n,
        transactionSignature: `settlement-${stamp}`,
      }),
      liveChannels.recordSettlement({
        taskId,
        providerId: "search",
        cumulativeAmountAtomic: 250000n,
        transactionSignature: `settlement-${stamp}`,
      }),
    ]);
    const settlementRows = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM settlements
      WHERE task_id = ${taskId} AND provider_id = 'search' AND transaction_signature = ${`settlement-${stamp}`}
    `;
    expect(settlementRows[0]?.count).toBe(1);

    await sql`UPDATE channels SET status = 'recovered' WHERE task_id = ${taskId} AND provider_id = 'search'`;
    expect(await liveChannels.beginFinalization({ ...input, startedAtUnixSeconds: now + 2n })).toBe("terminal");
  });

  it("writes wallet-scoped append-only audit events and redacts provider secrets", async () => {
    await sql`
      INSERT INTO providers (
        id, name, payee, protocol, mode, description, endpoint, config,
        owner_wallet, is_system, status, health_status, supported_networks,
        supported_assets, pricing_model, secret_config, credential_kind
      ) VALUES (
        ${providerId}, 'Security provider', 'provider:security', 'x402', 'x402',
        'security fixture', 'https://provider.example.test', '{"internal":"redact-me"}'::jsonb,
        ${owner}, FALSE, 'active', 'unknown', '["solana:devnet"]'::jsonb,
        '["USDC"]'::jsonb, 'challenge', '{"ciphertext":"redact-me"}'::jsonb, 'bearer'
      )
    `;

    const ownerEvents = await security.listAuditEvents(owner, 100);
    const providerEvent = ownerEvents.find((event) => event.resourceType === "providers" && event.resourceId === providerId);
    expect(providerEvent).toBeTruthy();
    expect(providerEvent?.afterState).not.toHaveProperty("secret_config");
    expect(providerEvent?.afterState).not.toHaveProperty("config");
    expect((await security.listAuditEvents(otherOwner, 100)).some((event) => event.resourceId === providerId)).toBe(false);

    await expect(sql`
      UPDATE audit_events SET action = 'update' WHERE id = ${providerEvent!.id}
    `).rejects.toThrow(/append-only/i);
  });
});
