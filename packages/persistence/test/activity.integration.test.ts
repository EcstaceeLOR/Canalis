import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import { migrateDatabase } from "../src/migrate.js";
import { PostgresActivityRepository } from "../src/activity.js";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;

dbDescribe("activity and guided recovery persistence", () => {
  let sql: Sql;
  let activity: PostgresActivityRepository;
  const stamp = Date.now();
  const owner = `activity-owner-${stamp}`;
  const otherOwner = `${owner}-other`;
  const providerId = `activity-provider-${stamp}`;
  const taskId = `activity-task-${stamp}`;
  const ambiguousTaskId = `activity-ambiguous-${stamp}`;
  const otherTaskId = `activity-other-${stamp}`;
  const now = BigInt(Math.floor(Date.now() / 1000));

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    sql = postgres(databaseUrl!, { max: 2, prepare: false });
    activity = new PostgresActivityRepository(databaseUrl!);

    await sql`
      INSERT INTO providers (
        id, name, payee, protocol, mode, description, owner_wallet, is_system,
        status, health_status, supported_networks, supported_assets, pricing_model,
        last_health_check_at_unix, last_error_at_unix, last_error_code, last_error_message
      ) VALUES (
        ${providerId}, 'Activity provider', 'provider:activity', 'x402', 'x402', 'activity fixture',
        ${owner}, FALSE, 'active', 'unhealthy', '["solana-devnet"]'::jsonb, '["USDC"]'::jsonb,
        'challenge', ${(now - 120n).toString()}::bigint, ${(now - 120n).toString()}::bigint,
        'PROVIDER_UNHEALTHY', 'raw upstream detail that must never be shown to users'
      )
    `;

    await sql`
      INSERT INTO tasks (id, owner, agent_id, mode, mint, budget_atomic, status, created_at_unix, expires_at_unix, updated_at_unix)
      VALUES
        (${taskId}, ${owner}, 'activity-agent', 'x402', 'USDC', 400000, 'completed', ${(now - 500n).toString()}, ${(now - 10n).toString()}, ${(now - 20n).toString()}),
        (${ambiguousTaskId}, ${owner}, 'activity-agent', 'x402', 'USDC', 250000, 'completed', ${(now - 400n).toString()}, ${(now - 10n).toString()}, ${(now - 15n).toString()}),
        (${otherTaskId}, ${otherOwner}, 'private-agent', 'deterministic', 'USDC', 999000, 'completed', ${(now - 300n).toString()}, ${(now - 10n).toString()}, ${(now - 10n).toString()})
    `;

    await sql`
      INSERT INTO channels (
        task_id, provider_id, program_address, network, channel_address, ceiling_atomic,
        cumulative_authorized_atomic, spent_atomic, status, recovery_state, created_at_unix, updated_at_unix
      ) VALUES
        (${taskId}, ${providerId}, 'program', 'solana-devnet', 'activity-channel', 400000, 100000, 100000, 'open', '{}'::jsonb, ${(now - 500n).toString()}, ${(now - 20n).toString()}),
        (${ambiguousTaskId}, ${providerId}, 'program', 'solana-devnet', 'ambiguous-channel', 250000, 50000, 50000, 'failed', '{"stage":"finalization-ambiguous","automaticRetryBlocked":true}'::jsonb, ${(now - 400n).toString()}, ${(now - 15n).toString()}),
        (${otherTaskId}, 'search', 'program', 'application', 'private-channel', 999000, 0, 0, 'open', '{}'::jsonb, ${(now - 300n).toString()}, ${(now - 10n).toString()})
    `;

    await sql`
      INSERT INTO flows (
        id, task_id, provider_id, request_id, status, quoted_amount_atomic,
        previous_cumulative_atomic, next_cumulative_atomic, rejection_code, error_message, created_at_unix
      ) VALUES
        (${`activity-flow-fail-${stamp}`}, ${taskId}, ${providerId}, 'request-fail', 'failed', 100000, 0, 0, 'PROVIDER_EXECUTION_FAILED', 'sensitive raw provider detail', ${(now - 30n).toString()}),
        (${`activity-flow-other-${stamp}`}, ${otherTaskId}, 'search', 'private-request', 'failed', 1000, 0, 0, 'PROVIDER_EXECUTION_FAILED', 'private wallet detail', ${(now - 5n).toString()})
    `;
  });

  afterAll(async () => {
    await activity.close();
    await sql.end({ timeout: 5 });
  });

  it("creates durable deduplicated incidents with safe recovery actions", async () => {
    await activity.synchronizeOperationalActivity(owner);
    const first = await activity.list(owner, { page: 1, pageSize: 100 });

    const providerIncident = first.events.find((event) => event.fingerprint === `provider:${providerId}:unhealthy`);
    expect(providerIncident).toMatchObject({ state: "open", providerId, actionKind: "retest-provider" });
    expect(providerIncident?.message).not.toContain("raw upstream detail");

    const partialSettlement = first.events.find((event) => event.fingerprint === `channel:${taskId}:${providerId}:recoverable`);
    expect(partialSettlement).toMatchObject({ state: "open", taskId, providerId, actionKind: "finalize-channel" });

    const ambiguous = first.events.find((event) => event.fingerprint === `channel:${ambiguousTaskId}:${providerId}:recovery`);
    expect(ambiguous).toMatchObject({ state: "open", severity: "critical", actionKind: "inspect-channel" });
    expect(ambiguous?.guidance?.toLowerCase()).toContain("do not retry automatically");

    const taskFailure = first.events.find((event) => event.fingerprint === `task:${taskId}:provider:${providerId}:failure`);
    expect(taskFailure).toMatchObject({ state: "open", actionKind: "open-task" });
    expect(taskFailure?.message).not.toContain("sensitive raw provider detail");
    expect(first.events.some((event) => event.taskId === otherTaskId)).toBe(false);

    await activity.synchronizeOperationalActivity(owner);
    const second = await activity.list(owner, { page: 1, pageSize: 100 });
    expect(second.events.find((event) => event.id === providerIncident?.id)?.occurrenceCount).toBe(1);
  });

  it("resolves incidents from canonical healthy and terminal state instead of duplicating them", async () => {
    await sql`
      UPDATE providers
      SET health_status = 'healthy', last_health_check_at_unix = ${now.toString()}::bigint,
          last_success_at_unix = ${now.toString()}::bigint, last_error_code = NULL,
          last_error_message = NULL, updated_at = NOW()
      WHERE id = ${providerId}
    `;
    await sql`
      INSERT INTO flows (
        id, task_id, provider_id, request_id, status, quoted_amount_atomic,
        previous_cumulative_atomic, next_cumulative_atomic, authorization_id, created_at_unix
      ) VALUES (
        ${`activity-flow-success-${stamp}`}, ${taskId}, ${providerId}, 'request-success', 'fulfilled', 100000,
        0, 100000, 'auth-success', ${(now + 1n).toString()}
      )
    `;
    await sql`
      UPDATE channels
      SET status = 'distributed', settle_transaction_signature = 'settle-activity-proof',
          distribution_transaction_signature = 'distribution-activity-proof',
          refund_transaction_signature = 'refund-activity-proof',
          recovery_state = '{"stage":"finalized"}'::jsonb,
          updated_at_unix = ${(now + 2n).toString()}
      WHERE task_id IN (${taskId}, ${ambiguousTaskId}) AND provider_id = ${providerId}
    `;

    await activity.synchronizeOperationalActivity(owner);
    const result = await activity.list(owner, { page: 1, pageSize: 100 });
    expect(result.events.find((event) => event.fingerprint === `provider:${providerId}:unhealthy`)?.state).toBe("resolved");
    expect(result.events.find((event) => event.fingerprint === `task:${taskId}:provider:${providerId}:failure`)?.state).toBe("resolved");
    expect(result.events.find((event) => event.fingerprint === `channel:${taskId}:${providerId}:recoverable`)?.state).toBe("resolved");
    expect(result.events.find((event) => event.fingerprint === `channel:${ambiguousTaskId}:${providerId}:recovery`)?.state).toBe("resolved");
    expect(result.events.some((event) => event.transactionSignature === "refund-activity-proof" && event.category === "recovery")).toBe(true);
  });

  it("keeps read state wallet-scoped", async () => {
    const result = await activity.list(owner, { page: 1, pageSize: 100 });
    const event = result.events[0]!;
    const marked = await activity.markRead(owner, event.id, true);
    expect(marked?.read).toBe(true);
    expect(await activity.markRead(otherOwner, event.id, true)).toBeNull();
  });
});
