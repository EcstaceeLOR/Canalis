import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import { migrateDatabase } from "../src/migrate.js";
import { PostgresOperationsRepository } from "../src/operations.js";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;

dbDescribe("operational dashboard and analytics persistence", () => {
  let sql: Sql;
  let operations: PostgresOperationsRepository;
  const stamp = Date.now();
  const owner = `ops-owner-${stamp}`;
  const otherOwner = `${owner}-other`;
  const providerId = `ops-provider-${stamp}`;
  const completedTask = `ops-completed-${stamp}`;
  const activeTask = `ops-active-${stamp}`;
  const recoverableTask = `ops-recoverable-${stamp}`;
  const otherTask = `ops-other-${stamp}`;
  const now = 2_100_000_000n;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    sql = postgres(databaseUrl!, { max: 2, prepare: false });
    operations = new PostgresOperationsRepository(databaseUrl!);

    await sql`
      INSERT INTO providers (
        id, name, payee, protocol, mode, description, owner_wallet, is_system,
        status, health_status, supported_networks, supported_assets, pricing_model,
        last_health_check_at_unix, last_error_at_unix, last_error_code, last_error_message
      ) VALUES (
        ${providerId}, 'Ops unhealthy provider', 'demo:ops', 'x402', 'x402', 'analytics fixture',
        ${owner}, FALSE, 'active', 'unhealthy', '["application"]'::jsonb, '["USDC"]'::jsonb,
        'challenge', ${(now - 20n).toString()}::bigint, ${(now - 20n).toString()}::bigint,
        'UPSTREAM_DOWN', 'Provider health probe failed'
      )
    `;

    await sql`
      INSERT INTO tasks (id, owner, agent_id, mode, mint, budget_atomic, status, created_at_unix, expires_at_unix, updated_at_unix)
      VALUES
        (${completedTask}, ${owner}, 'completed-agent', 'deterministic', 'USDC', 1000000, 'completed', ${(now - 1000n).toString()}, ${(now + 1000n).toString()}, ${(now - 100n).toString()}),
        (${activeTask}, ${owner}, 'active-agent', 'deterministic', 'USDC', 500000, 'active', ${(now - 800n).toString()}, ${(now + 5000n).toString()}, ${(now - 80n).toString()}),
        (${recoverableTask}, ${owner}, 'recoverable-agent', 'deterministic', 'USDC', 400000, 'completed', ${(now - 600n).toString()}, ${(now + 2000n).toString()}, ${(now - 50n).toString()}),
        (${otherTask}, ${otherOwner}, 'private-agent', 'deterministic', 'USDC', 999000, 'completed', ${(now - 500n).toString()}, ${(now + 2000n).toString()}, ${(now - 20n).toString()})
    `;

    await sql`
      INSERT INTO task_workspace_metadata (task_id, name, description, policy_id)
      VALUES
        (${completedTask}, 'Completed research', '', 'inline-bounded'),
        (${activeTask}, 'Active research', '', 'inline-bounded'),
        (${recoverableTask}, 'Needs recovery', '', 'inline-bounded'),
        (${otherTask}, 'Private task', '', 'inline-bounded')
    `;

    await sql`
      INSERT INTO channels (
        task_id, provider_id, program_address, network, channel_address, ceiling_atomic,
        cumulative_authorized_atomic, spent_atomic, status, settle_transaction_signature,
        distribution_transaction_signature, refund_transaction_signature, created_at_unix, updated_at_unix
      ) VALUES
        (${completedTask}, 'search', 'program', 'application', 'channel-completed', 1000000, 200000, 200000, 'recovered', 'settle-proof', 'distribution-proof', 'refund-proof', ${(now - 1000n).toString()}, ${(now - 100n).toString()}),
        (${activeTask}, 'data', 'program', 'application', 'channel-active', 500000, 0, 0, 'open', NULL, NULL, NULL, ${(now - 800n).toString()}, ${(now - 80n).toString()}),
        (${recoverableTask}, 'inference', 'program', 'application', 'channel-recoverable', 400000, 100000, 100000, 'open', NULL, NULL, NULL, ${(now - 600n).toString()}, ${(now - 50n).toString()})
    `;

    await sql`
      INSERT INTO flows (
        id, task_id, provider_id, request_id, status, quoted_amount_atomic,
        previous_cumulative_atomic, next_cumulative_atomic, authorization_id,
        payment_reference, created_at_unix
      ) VALUES
        (${`ops-flow-ok-${stamp}`}, ${completedTask}, 'search', 'request-ok', 'fulfilled', 200000, 0, 200000, 'auth-ok', 'pay-ok', ${(now - 500n).toString()}),
        (${`ops-flow-fail-${stamp}`}, ${recoverableTask}, 'inference', 'request-fail', 'failed', 100000, 0, 0, NULL, NULL, ${(now - 40n).toString()}),
        (${`ops-flow-other-${stamp}`}, ${otherTask}, 'search', 'request-private', 'fulfilled', 999000, 0, 999000, 'auth-private', 'pay-private', ${(now - 30n).toString()})
    `;

    await sql`
      INSERT INTO receipts (
        flow_id, task_id, provider_id, request_id, mint, price_atomic, protocol,
        authorization_id, payment_reference, response_hash, timestamp_unix
      ) VALUES
        (${`ops-flow-ok-${stamp}`}, ${completedTask}, 'search', 'request-ok', 'USDC', 200000, 'demo', 'auth-ok', 'pay-ok', 'hash-ok', ${(now - 500n).toString()}),
        (${`ops-flow-other-${stamp}`}, ${otherTask}, 'search', 'request-private', 'USDC', 999000, 'demo', 'auth-private', 'pay-private', 'hash-private', ${(now - 30n).toString()})
    `;
  });

  afterAll(async () => {
    await operations.close();
    await sql.end({ timeout: 5 });
  });

  it("reconciles dashboard metrics from wallet-scoped persisted records", async () => {
    const dashboard = await operations.getDashboard(owner, now);
    expect(dashboard.tasks).toMatchObject({ total: 3, active: 1, completed: 2, cancelled: 0 });
    expect(dashboard.channels.total).toBe(3);
    expect(dashboard.channels.active).toBe(1);
    expect(dashboard.channels.settlementHealthy).toBe(1);
    expect(dashboard.channels.recoverable).toBe(1);
    expect(dashboard.channels.requiringAction).toBeGreaterThanOrEqual(1);
    expect(dashboard.money.authorizedAtomic).toBe("200000");
    expect(dashboard.money.settledAtomic).toBe("200000");
    expect(dashboard.money.recoveredAtomic).toBe("800000");
    expect(dashboard.money.recoverableAtomic).toBe("300000");
    expect(dashboard.providerIncidents.some((incident) => incident.id === providerId)).toBe(true);
    expect(dashboard.channelsRequiringAction.some((channel) => channel.taskId === recoverableTask)).toBe(true);
    expect(dashboard.recentActivity.some((activity) => activity.kind === "authorization")).toBe(true);
    expect(dashboard.recentTasks.some((task) => task.id === otherTask)).toBe(false);
  });

  it("aggregates bounded analytics without leaking another wallet", async () => {
    const analytics = await operations.getAnalytics(owner, {
      preset: "custom",
      fromUnixSeconds: now - 2_000n,
      toUnixSeconds: now,
      bucketSeconds: 300,
    });
    expect(analytics.tasks.total).toBe(3);
    expect(analytics.tasks.active).toBe(1);
    expect(analytics.tasks.successful).toBe(1);
    expect(analytics.tasks.failed).toBe(1);
    expect(analytics.calls).toEqual({ total: 2, failed: 1 });
    expect(analytics.spend).toEqual({ authorizedAtomic: "200000", settledAtomic: "200000", recoveredAtomic: "800000" });
    expect(analytics.rates.taskSuccessPercent).toBe(50);
    expect(analytics.rates.taskFailurePercent).toBe(50);
    expect(analytics.rates.callFailurePercent).toBe(50);
    expect(analytics.latency.averageSettlementSeconds).toBe(900);
    expect(analytics.latency.averageRecoverySeconds).toBe(900);
    expect(analytics.series.some((point) => point.authorizedAtomic === "200000")).toBe(true);
    expect(analytics.breakdowns.tasks.some((row) => row.key === completedTask)).toBe(true);
    expect(analytics.breakdowns.tasks.some((row) => row.key === otherTask)).toBe(false);
    expect(analytics.breakdowns.providers.some((row) => row.key === "search")).toBe(true);
    expect(analytics.breakdowns.statuses.find((row) => row.key === "completed")?.count).toBe(2);
  });
});
