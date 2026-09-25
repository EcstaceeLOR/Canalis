import type {
  AnalyticsMoneyBreakdown,
  AnalyticsSeriesPoint,
  AnalyticsStatusBreakdown,
  OperationalActivity,
  OperationalAnalytics,
  OperationalChannelAction,
  OperationalDashboard,
  OperationalProviderIncident,
  OperationalTaskSummary,
  OperationsAnalyticsRangeQuery,
} from "@canalis/application";
import postgres, { type Sql } from "postgres";

function text(value: unknown, fallback = "0") {
  return value === null || value === undefined ? fallback : String(value);
}

function count(value: unknown) {
  return Number(value ?? 0);
}

function maybeText(value: unknown) {
  return value === null || value === undefined || String(value) === "" ? undefined : String(value);
}

function percent(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function mapBreakdown(row: Record<string, unknown>): AnalyticsMoneyBreakdown {
  return {
    key: text(row.key, "unknown"),
    label: text(row.label, "Unknown"),
    count: count(row.event_count),
    authorizedAtomic: text(row.authorized_atomic),
    settledAtomic: text(row.settled_atomic),
    recoveredAtomic: text(row.recovered_atomic),
  };
}

export class PostgresOperationsRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 5, prepare: false });
  }

  async getDashboard(
    owner: string,
    nowUnixSeconds = BigInt(Math.floor(Date.now() / 1000)),
  ): Promise<OperationalDashboard> {
    const now = nowUnixSeconds.toString();
    const [taskRows, channelRows, providerRows, moneyRows, recentTaskRows, actionRows, incidentRows, activityRows] = await Promise.all([
      this.sql<Record<string, unknown>[]>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
        FROM tasks
        WHERE owner = ${owner}
      `,
      this.sql<Record<string, unknown>[]>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE c.status = 'open'
              AND t.status = 'active'
              AND t.expires_at_unix > ${now}::bigint
              AND COALESCE(c.recovery_state->>'stage', '') NOT IN ('finalization-started', 'finalization-ambiguous')
              AND NOT COALESCE((c.recovery_state->>'automaticRetryBlocked')::boolean, false)
          )::int AS active,
          COUNT(*) FILTER (WHERE c.status IN ('distributed', 'recovered'))::int AS settlement_healthy,
          COUNT(*) FILTER (
            WHERE c.status = 'sealed'
               OR (c.status = 'open' AND (t.status IN ('completed', 'cancelled', 'archived') OR t.expires_at_unix <= ${now}::bigint))
          )::int AS settlement_pending,
          COUNT(*) FILTER (
            WHERE c.status = 'failed'
               OR COALESCE(c.recovery_state->>'stage', '') IN ('finalization-started', 'finalization-ambiguous')
               OR COALESCE((c.recovery_state->>'automaticRetryBlocked')::boolean, false)
               OR c.status = 'sealed'
               OR (c.status NOT IN ('distributed', 'recovered') AND t.expires_at_unix <= ${now}::bigint)
               OR (c.status = 'open' AND c.ceiling_atomic > c.cumulative_authorized_atomic AND t.status IN ('completed', 'cancelled', 'archived'))
          )::int AS requiring_action,
          COUNT(*) FILTER (
            WHERE c.status = 'open'
              AND c.ceiling_atomic > c.cumulative_authorized_atomic
              AND (t.status IN ('completed', 'cancelled', 'archived') OR t.expires_at_unix <= ${now}::bigint)
          )::int AS recoverable,
          COUNT(*) FILTER (
            WHERE c.status = 'failed'
               OR COALESCE(c.recovery_state->>'stage', '') IN ('finalization-started', 'finalization-ambiguous')
               OR COALESCE((c.recovery_state->>'automaticRetryBlocked')::boolean, false)
          )::int AS failed
        FROM channels c
        JOIN tasks t ON t.id = c.task_id
        WHERE t.owner = ${owner}
      `,
      this.sql<Record<string, unknown>[]>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE pr.status = 'active' AND pr.health_status = 'healthy')::int AS healthy,
          COUNT(*) FILTER (WHERE pr.status = 'active' AND pr.health_status = 'unhealthy')::int AS unhealthy,
          COUNT(*) FILTER (WHERE pr.status = 'active' AND pr.health_status = 'unknown')::int AS unknown,
          COUNT(*) FILTER (WHERE pr.status = 'disabled')::int AS disabled
        FROM providers pr
        WHERE pr.is_system = TRUE OR pr.owner_wallet = ${owner}
      `,
      this.sql<Record<string, unknown>[]>`
        SELECT
          COALESCE((
            SELECT SUM(r.price_atomic)
            FROM receipts r
            JOIN tasks t ON t.id = r.task_id
            WHERE t.owner = ${owner}
          ), 0) AS authorized_atomic,
          COALESCE((
            SELECT SUM(c.spent_atomic)
            FROM channels c
            JOIN tasks t ON t.id = c.task_id
            WHERE t.owner = ${owner}
              AND (
                c.settle_transaction_signature IS NOT NULL
                OR c.distribution_transaction_signature IS NOT NULL
                OR c.status IN ('distributed', 'recovered')
              )
          ), 0) AS settled_atomic,
          COALESCE((
            SELECT SUM(GREATEST(c.ceiling_atomic - c.spent_atomic, 0))
            FROM channels c
            JOIN tasks t ON t.id = c.task_id
            WHERE t.owner = ${owner}
              AND (c.refund_transaction_signature IS NOT NULL OR c.status = 'recovered')
          ), 0) AS recovered_atomic,
          COALESCE((
            SELECT SUM(GREATEST(c.ceiling_atomic - c.cumulative_authorized_atomic, 0))
            FROM channels c
            JOIN tasks t ON t.id = c.task_id
            WHERE t.owner = ${owner}
              AND c.status = 'open'
              AND c.ceiling_atomic > c.cumulative_authorized_atomic
              AND (t.status IN ('completed', 'cancelled', 'archived') OR t.expires_at_unix <= ${now}::bigint)
          ), 0) AS recoverable_atomic
      `,
      this.sql<Record<string, unknown>[]>`
        SELECT
          t.id,
          COALESCE(m.name, t.agent_id) AS name,
          t.status,
          t.mode,
          t.budget_atomic,
          COALESCE((SELECT SUM(c.spent_atomic) FROM channels c WHERE c.task_id = t.id), 0) AS spent_atomic,
          GREATEST(t.budget_atomic - COALESCE((SELECT SUM(c.spent_atomic) FROM channels c WHERE c.task_id = t.id), 0), 0) AS recoverable_atomic,
          t.updated_at_unix
        FROM tasks t
        LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
        WHERE t.owner = ${owner}
        ORDER BY t.updated_at_unix DESC, t.id ASC
        LIMIT 6
      `,
      this.sql<Record<string, unknown>[]>`
        SELECT
          c.task_id || ':' || c.provider_id AS id,
          c.task_id,
          COALESCE(m.name, t.agent_id) AS task_name,
          c.provider_id,
          COALESCE(pr.name, c.provider_id) AS provider_name,
          c.network,
          CASE
            WHEN c.status = 'failed'
              OR COALESCE(c.recovery_state->>'stage', '') IN ('finalization-started', 'finalization-ambiguous')
              OR COALESCE((c.recovery_state->>'automaticRetryBlocked')::boolean, false)
              THEN 'failed'
            WHEN c.status = 'sealed' THEN 'sealed'
            WHEN c.status NOT IN ('distributed', 'recovered') AND t.expires_at_unix <= ${now}::bigint THEN 'expired'
            ELSE 'recoverable'
          END AS operational_status,
          GREATEST(c.ceiling_atomic - c.cumulative_authorized_atomic, 0) AS recoverable_atomic,
          c.updated_at_unix,
          CASE
            WHEN c.status = 'failed'
              OR COALESCE(c.recovery_state->>'stage', '') IN ('finalization-started', 'finalization-ambiguous')
              OR COALESCE((c.recovery_state->>'automaticRetryBlocked')::boolean, false)
              THEN 'inspect'
            WHEN c.cumulative_authorized_atomic = 0 THEN 'recover'
            ELSE 'finalize'
          END AS next_action
        FROM channels c
        JOIN tasks t ON t.id = c.task_id
        LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
        LEFT JOIN providers pr ON pr.id = c.provider_id
        WHERE t.owner = ${owner}
          AND (
            c.status = 'failed'
            OR COALESCE(c.recovery_state->>'stage', '') IN ('finalization-started', 'finalization-ambiguous')
            OR COALESCE((c.recovery_state->>'automaticRetryBlocked')::boolean, false)
            OR c.status = 'sealed'
            OR (c.status NOT IN ('distributed', 'recovered') AND t.expires_at_unix <= ${now}::bigint)
            OR (c.status = 'open' AND c.ceiling_atomic > c.cumulative_authorized_atomic AND t.status IN ('completed', 'cancelled', 'archived'))
          )
        ORDER BY
          CASE
            WHEN c.status = 'failed'
              OR COALESCE(c.recovery_state->>'stage', '') IN ('finalization-started', 'finalization-ambiguous')
              OR COALESCE((c.recovery_state->>'automaticRetryBlocked')::boolean, false) THEN 0
            WHEN c.status = 'sealed' THEN 1
            ELSE 2
          END,
          c.updated_at_unix DESC
        LIMIT 6
      `,
      this.sql<Record<string, unknown>[]>`
        SELECT
          pr.id,
          pr.name,
          pr.protocol,
          pr.status,
          pr.health_status,
          pr.last_health_check_at_unix,
          pr.last_error_at_unix,
          pr.last_error_code,
          pr.last_error_message
        FROM providers pr
        WHERE (pr.is_system = TRUE OR pr.owner_wallet = ${owner})
          AND pr.status = 'active'
          AND (pr.health_status IN ('unhealthy', 'unknown') OR pr.last_error_at_unix IS NOT NULL)
        ORDER BY COALESCE(pr.last_error_at_unix, pr.last_health_check_at_unix, 0) DESC, pr.name ASC
        LIMIT 6
      `,
      this.sql<Record<string, unknown>[]>`
        WITH activity AS (
          SELECT
            'authorization:' || f.id AS id,
            'authorization'::text AS kind,
            f.status::text AS status,
            t.id AS task_id,
            COALESCE(m.name, t.agent_id) AS task_name,
            r.provider_id,
            COALESCE(pr.name, r.provider_id) AS provider_name,
            r.protocol,
            c.network,
            r.price_atomic AS amount_atomic,
            r.timestamp_unix AS timestamp_unix_seconds
          FROM receipts r
          JOIN flows f ON f.id = r.flow_id
          JOIN tasks t ON t.id = r.task_id
          LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
          LEFT JOIN providers pr ON pr.id = r.provider_id
          LEFT JOIN channels c ON c.task_id = r.task_id AND c.provider_id = r.provider_id
          WHERE t.owner = ${owner}

          UNION ALL

          SELECT
            CASE WHEN f.status = 'rejected' THEN 'rejection:' ELSE 'failure:' END || f.id AS id,
            CASE WHEN f.status = 'rejected' THEN 'rejection' ELSE 'failure' END::text AS kind,
            f.status::text AS status,
            t.id AS task_id,
            COALESCE(m.name, t.agent_id) AS task_name,
            f.provider_id,
            COALESCE(pr.name, f.provider_id) AS provider_name,
            pr.protocol,
            c.network,
            GREATEST(f.next_cumulative_atomic - f.previous_cumulative_atomic, 0) AS amount_atomic,
            f.created_at_unix AS timestamp_unix_seconds
          FROM flows f
          JOIN tasks t ON t.id = f.task_id
          LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
          LEFT JOIN providers pr ON pr.id = f.provider_id
          LEFT JOIN channels c ON c.task_id = f.task_id AND c.provider_id = f.provider_id
          WHERE t.owner = ${owner} AND f.status IN ('failed', 'rejected')

          UNION ALL

          SELECT
            'settlement:' || c.task_id || ':' || c.provider_id AS id,
            'settlement'::text AS kind,
            'confirmed'::text AS status,
            t.id AS task_id,
            COALESCE(m.name, t.agent_id) AS task_name,
            c.provider_id,
            COALESCE(pr.name, c.provider_id) AS provider_name,
            COALESCE(pr.protocol, t.mode) AS protocol,
            c.network,
            c.cumulative_authorized_atomic AS amount_atomic,
            c.updated_at_unix AS timestamp_unix_seconds
          FROM channels c
          JOIN tasks t ON t.id = c.task_id
          LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
          LEFT JOIN providers pr ON pr.id = c.provider_id
          WHERE t.owner = ${owner} AND c.settle_transaction_signature IS NOT NULL

          UNION ALL

          SELECT
            'distribution:' || c.task_id || ':' || c.provider_id AS id,
            'distribution'::text AS kind,
            'confirmed'::text AS status,
            t.id AS task_id,
            COALESCE(m.name, t.agent_id) AS task_name,
            c.provider_id,
            COALESCE(pr.name, c.provider_id) AS provider_name,
            COALESCE(pr.protocol, t.mode) AS protocol,
            c.network,
            c.spent_atomic AS amount_atomic,
            c.updated_at_unix AS timestamp_unix_seconds
          FROM channels c
          JOIN tasks t ON t.id = c.task_id
          LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
          LEFT JOIN providers pr ON pr.id = c.provider_id
          WHERE t.owner = ${owner} AND c.distribution_transaction_signature IS NOT NULL

          UNION ALL

          SELECT
            'recovery:' || c.task_id || ':' || c.provider_id AS id,
            'recovery'::text AS kind,
            'confirmed'::text AS status,
            t.id AS task_id,
            COALESCE(m.name, t.agent_id) AS task_name,
            c.provider_id,
            COALESCE(pr.name, c.provider_id) AS provider_name,
            COALESCE(pr.protocol, t.mode) AS protocol,
            c.network,
            GREATEST(c.ceiling_atomic - c.spent_atomic, 0) AS amount_atomic,
            c.updated_at_unix AS timestamp_unix_seconds
          FROM channels c
          JOIN tasks t ON t.id = c.task_id
          LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
          LEFT JOIN providers pr ON pr.id = c.provider_id
          WHERE t.owner = ${owner} AND c.refund_transaction_signature IS NOT NULL
        )
        SELECT * FROM activity
        ORDER BY timestamp_unix_seconds DESC, id ASC
        LIMIT 10
      `,
    ]);

    const task = taskRows[0] ?? {};
    const channel = channelRows[0] ?? {};
    const provider = providerRows[0] ?? {};
    const money = moneyRows[0] ?? {};

    const recentTasks: OperationalTaskSummary[] = recentTaskRows.map((row) => ({
      id: text(row.id, ""),
      name: text(row.name, "Untitled task"),
      status: text(row.status, "unknown"),
      mode: text(row.mode, "unknown"),
      budgetAtomic: text(row.budget_atomic),
      spentAtomic: text(row.spent_atomic),
      recoverableAtomic: text(row.recoverable_atomic),
      updatedAtUnixSeconds: text(row.updated_at_unix),
    }));

    const channelsRequiringAction: OperationalChannelAction[] = actionRows.map((row) => ({
      id: text(row.id, ""),
      taskId: text(row.task_id, ""),
      taskName: text(row.task_name, "Untitled task"),
      providerId: text(row.provider_id, ""),
      providerName: text(row.provider_name, "Unknown provider"),
      network: text(row.network, "application"),
      operationalStatus: text(row.operational_status) as OperationalChannelAction["operationalStatus"],
      recoverableAtomic: text(row.recoverable_atomic),
      updatedAtUnixSeconds: text(row.updated_at_unix),
      nextAction: text(row.next_action) as OperationalChannelAction["nextAction"],
    }));

    const providerIncidents: OperationalProviderIncident[] = incidentRows.map((row) => ({
      id: text(row.id, ""),
      name: text(row.name, "Unknown provider"),
      protocol: text(row.protocol, "unknown"),
      status: text(row.status, "unknown"),
      healthStatus: text(row.health_status, "unknown"),
      ...(maybeText(row.last_health_check_at_unix) ? { lastHealthCheckAtUnixSeconds: maybeText(row.last_health_check_at_unix) } : {}),
      ...(maybeText(row.last_error_at_unix) ? { lastErrorAtUnixSeconds: maybeText(row.last_error_at_unix) } : {}),
      ...(maybeText(row.last_error_code) ? { lastErrorCode: maybeText(row.last_error_code) } : {}),
      ...(maybeText(row.last_error_message) ? { lastErrorMessage: maybeText(row.last_error_message) } : {}),
    }));

    const recentActivity: OperationalActivity[] = activityRows.map((row) => ({
      id: text(row.id, ""),
      kind: text(row.kind) as OperationalActivity["kind"],
      status: text(row.status, "unknown"),
      taskId: text(row.task_id, ""),
      taskName: text(row.task_name, "Untitled task"),
      providerId: text(row.provider_id, ""),
      providerName: text(row.provider_name, "Unknown provider"),
      protocol: text(row.protocol, "unknown"),
      ...(maybeText(row.network) ? { network: maybeText(row.network) } : {}),
      amountAtomic: text(row.amount_atomic),
      timestampUnixSeconds: text(row.timestamp_unix_seconds),
    }));

    return {
      generatedAtUnixSeconds: now,
      tasks: {
        total: count(task.total),
        active: count(task.active),
        completed: count(task.completed),
        cancelled: count(task.cancelled),
      },
      channels: {
        total: count(channel.total),
        active: count(channel.active),
        settlementHealthy: count(channel.settlement_healthy),
        settlementPending: count(channel.settlement_pending),
        requiringAction: count(channel.requiring_action),
        recoverable: count(channel.recoverable),
        failed: count(channel.failed),
      },
      providers: {
        total: count(provider.total),
        healthy: count(provider.healthy),
        unhealthy: count(provider.unhealthy),
        unknown: count(provider.unknown),
        disabled: count(provider.disabled),
      },
      money: {
        authorizedAtomic: text(money.authorized_atomic),
        settledAtomic: text(money.settled_atomic),
        recoveredAtomic: text(money.recovered_atomic),
        recoverableAtomic: text(money.recoverable_atomic),
      },
      recentTasks,
      channelsRequiringAction,
      providerIncidents,
      recentActivity,
    };
  }

  async getAnalytics(owner: string, range: OperationsAnalyticsRangeQuery): Promise<OperationalAnalytics> {
    const from = range.fromUnixSeconds.toString();
    const to = range.toUnixSeconds.toString();
    const bucket = String(range.bucketSeconds);

    const [taskRows, flowRows, spendRows, latencyRows, seriesRows, breakdownRows, statusRows] = await Promise.all([
      this.sql<Record<string, unknown>[]>`
        WITH scoped AS (
          SELECT
            t.*,
            EXISTS (
              SELECT 1 FROM flows f
              WHERE f.task_id = t.id AND f.status IN ('failed', 'rejected')
            ) AS had_failure
          FROM tasks t
          WHERE t.owner = ${owner}
            AND t.created_at_unix >= ${from}::bigint
            AND t.created_at_unix <= ${to}::bigint
        )
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
          COUNT(*) FILTER (WHERE status = 'completed' AND NOT had_failure)::int AS successful,
          COUNT(*) FILTER (WHERE status = 'cancelled' OR had_failure)::int AS failed,
          COALESCE(SUM(budget_atomic), 0) AS budget_atomic
        FROM scoped
      `,
      this.sql<Record<string, unknown>[]>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE f.status IN ('failed', 'rejected'))::int AS failed
        FROM flows f
        JOIN tasks t ON t.id = f.task_id
        WHERE t.owner = ${owner}
          AND f.created_at_unix >= ${from}::bigint
          AND f.created_at_unix <= ${to}::bigint
      `,
      this.sql<Record<string, unknown>[]>`
        SELECT
          COALESCE((
            SELECT SUM(r.price_atomic)
            FROM receipts r
            JOIN tasks t ON t.id = r.task_id
            WHERE t.owner = ${owner}
              AND r.timestamp_unix >= ${from}::bigint
              AND r.timestamp_unix <= ${to}::bigint
          ), 0) AS authorized_atomic,
          COALESCE((
            SELECT SUM(c.spent_atomic)
            FROM channels c
            JOIN tasks t ON t.id = c.task_id
            WHERE t.owner = ${owner}
              AND c.updated_at_unix >= ${from}::bigint
              AND c.updated_at_unix <= ${to}::bigint
              AND (
                c.settle_transaction_signature IS NOT NULL
                OR c.distribution_transaction_signature IS NOT NULL
                OR c.status IN ('distributed', 'recovered')
              )
          ), 0) AS settled_atomic,
          COALESCE((
            SELECT SUM(GREATEST(c.ceiling_atomic - c.spent_atomic, 0))
            FROM channels c
            JOIN tasks t ON t.id = c.task_id
            WHERE t.owner = ${owner}
              AND c.updated_at_unix >= ${from}::bigint
              AND c.updated_at_unix <= ${to}::bigint
              AND (c.refund_transaction_signature IS NOT NULL OR c.status = 'recovered')
          ), 0) AS recovered_atomic
      `,
      this.sql<Record<string, unknown>[]>`
        SELECT
          AVG(c.updated_at_unix - c.created_at_unix) FILTER (
            WHERE (
              c.settle_transaction_signature IS NOT NULL
              OR c.distribution_transaction_signature IS NOT NULL
              OR c.status IN ('distributed', 'recovered')
            )
          ) AS average_settlement_seconds,
          AVG(c.updated_at_unix - c.created_at_unix) FILTER (
            WHERE c.refund_transaction_signature IS NOT NULL OR c.status = 'recovered'
          ) AS average_recovery_seconds
        FROM channels c
        JOIN tasks t ON t.id = c.task_id
        WHERE t.owner = ${owner}
          AND c.updated_at_unix >= ${from}::bigint
          AND c.updated_at_unix <= ${to}::bigint
      `,
      this.sql<Record<string, unknown>[]>`
        WITH buckets AS (
          SELECT generate_series(
            ((${from}::bigint / ${bucket}::bigint) * ${bucket}::bigint),
            ${to}::bigint,
            ${bucket}::bigint
          )::bigint AS bucket_start
        ),
        authorized AS (
          SELECT ((r.timestamp_unix / ${bucket}::bigint) * ${bucket}::bigint) AS bucket_start,
                 SUM(r.price_atomic) AS amount
          FROM receipts r
          JOIN tasks t ON t.id = r.task_id
          WHERE t.owner = ${owner}
            AND r.timestamp_unix >= ${from}::bigint
            AND r.timestamp_unix <= ${to}::bigint
          GROUP BY 1
        ),
        settled AS (
          SELECT ((c.updated_at_unix / ${bucket}::bigint) * ${bucket}::bigint) AS bucket_start,
                 SUM(c.spent_atomic) AS amount
          FROM channels c
          JOIN tasks t ON t.id = c.task_id
          WHERE t.owner = ${owner}
            AND c.updated_at_unix >= ${from}::bigint
            AND c.updated_at_unix <= ${to}::bigint
            AND (
              c.settle_transaction_signature IS NOT NULL
              OR c.distribution_transaction_signature IS NOT NULL
              OR c.status IN ('distributed', 'recovered')
            )
          GROUP BY 1
        ),
        recovered AS (
          SELECT ((c.updated_at_unix / ${bucket}::bigint) * ${bucket}::bigint) AS bucket_start,
                 SUM(GREATEST(c.ceiling_atomic - c.spent_atomic, 0)) AS amount
          FROM channels c
          JOIN tasks t ON t.id = c.task_id
          WHERE t.owner = ${owner}
            AND c.updated_at_unix >= ${from}::bigint
            AND c.updated_at_unix <= ${to}::bigint
            AND (c.refund_transaction_signature IS NOT NULL OR c.status = 'recovered')
          GROUP BY 1
        ),
        failures AS (
          SELECT ((f.created_at_unix / ${bucket}::bigint) * ${bucket}::bigint) AS bucket_start,
                 COUNT(*)::int AS event_count
          FROM flows f
          JOIN tasks t ON t.id = f.task_id
          WHERE t.owner = ${owner}
            AND f.created_at_unix >= ${from}::bigint
            AND f.created_at_unix <= ${to}::bigint
            AND f.status IN ('failed', 'rejected')
          GROUP BY 1
        )
        SELECT
          b.bucket_start,
          COALESCE(a.amount, 0) AS authorized_atomic,
          COALESCE(s.amount, 0) AS settled_atomic,
          COALESCE(r.amount, 0) AS recovered_atomic,
          COALESCE(f.event_count, 0)::int AS failures
        FROM buckets b
        LEFT JOIN authorized a USING (bucket_start)
        LEFT JOIN settled s USING (bucket_start)
        LEFT JOIN recovered r USING (bucket_start)
        LEFT JOIN failures f USING (bucket_start)
        ORDER BY b.bucket_start ASC
      `,
      this.sql<Record<string, unknown>[]>`
        WITH spend_events AS (
          SELECT
            t.id AS task_id,
            COALESCE(m.name, t.agent_id) AS task_name,
            r.provider_id,
            COALESCE(pr.name, r.provider_id) AS provider_name,
            r.protocol,
            COALESCE(c.network, 'application') AS network,
            'authorization'::text AS metric,
            r.price_atomic AS amount_atomic
          FROM receipts r
          JOIN tasks t ON t.id = r.task_id
          LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
          LEFT JOIN providers pr ON pr.id = r.provider_id
          LEFT JOIN channels c ON c.task_id = r.task_id AND c.provider_id = r.provider_id
          WHERE t.owner = ${owner}
            AND r.timestamp_unix >= ${from}::bigint
            AND r.timestamp_unix <= ${to}::bigint

          UNION ALL

          SELECT
            t.id AS task_id,
            COALESCE(m.name, t.agent_id) AS task_name,
            c.provider_id,
            COALESCE(pr.name, c.provider_id) AS provider_name,
            COALESCE(pr.protocol, t.mode) AS protocol,
            COALESCE(c.network, 'application') AS network,
            'settlement'::text AS metric,
            c.spent_atomic AS amount_atomic
          FROM channels c
          JOIN tasks t ON t.id = c.task_id
          LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
          LEFT JOIN providers pr ON pr.id = c.provider_id
          WHERE t.owner = ${owner}
            AND c.updated_at_unix >= ${from}::bigint
            AND c.updated_at_unix <= ${to}::bigint
            AND (
              c.settle_transaction_signature IS NOT NULL
              OR c.distribution_transaction_signature IS NOT NULL
              OR c.status IN ('distributed', 'recovered')
            )

          UNION ALL

          SELECT
            t.id AS task_id,
            COALESCE(m.name, t.agent_id) AS task_name,
            c.provider_id,
            COALESCE(pr.name, c.provider_id) AS provider_name,
            COALESCE(pr.protocol, t.mode) AS protocol,
            COALESCE(c.network, 'application') AS network,
            'recovery'::text AS metric,
            GREATEST(c.ceiling_atomic - c.spent_atomic, 0) AS amount_atomic
          FROM channels c
          JOIN tasks t ON t.id = c.task_id
          LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
          LEFT JOIN providers pr ON pr.id = c.provider_id
          WHERE t.owner = ${owner}
            AND c.updated_at_unix >= ${from}::bigint
            AND c.updated_at_unix <= ${to}::bigint
            AND (c.refund_transaction_signature IS NOT NULL OR c.status = 'recovered')
        ),
        aggregated AS (
          SELECT
            'task'::text AS dimension,
            task_id AS key,
            MAX(task_name) AS label,
            COUNT(*)::int AS event_count,
            COALESCE(SUM(amount_atomic) FILTER (WHERE metric = 'authorization'), 0) AS authorized_atomic,
            COALESCE(SUM(amount_atomic) FILTER (WHERE metric = 'settlement'), 0) AS settled_atomic,
            COALESCE(SUM(amount_atomic) FILTER (WHERE metric = 'recovery'), 0) AS recovered_atomic
          FROM spend_events GROUP BY task_id

          UNION ALL

          SELECT
            'provider'::text AS dimension,
            provider_id AS key,
            MAX(provider_name) AS label,
            COUNT(*)::int AS event_count,
            COALESCE(SUM(amount_atomic) FILTER (WHERE metric = 'authorization'), 0) AS authorized_atomic,
            COALESCE(SUM(amount_atomic) FILTER (WHERE metric = 'settlement'), 0) AS settled_atomic,
            COALESCE(SUM(amount_atomic) FILTER (WHERE metric = 'recovery'), 0) AS recovered_atomic
          FROM spend_events GROUP BY provider_id

          UNION ALL

          SELECT
            'protocol'::text AS dimension,
            protocol AS key,
            UPPER(protocol) AS label,
            COUNT(*)::int AS event_count,
            COALESCE(SUM(amount_atomic) FILTER (WHERE metric = 'authorization'), 0) AS authorized_atomic,
            COALESCE(SUM(amount_atomic) FILTER (WHERE metric = 'settlement'), 0) AS settled_atomic,
            COALESCE(SUM(amount_atomic) FILTER (WHERE metric = 'recovery'), 0) AS recovered_atomic
          FROM spend_events GROUP BY protocol

          UNION ALL

          SELECT
            'network'::text AS dimension,
            network AS key,
            network AS label,
            COUNT(*)::int AS event_count,
            COALESCE(SUM(amount_atomic) FILTER (WHERE metric = 'authorization'), 0) AS authorized_atomic,
            COALESCE(SUM(amount_atomic) FILTER (WHERE metric = 'settlement'), 0) AS settled_atomic,
            COALESCE(SUM(amount_atomic) FILTER (WHERE metric = 'recovery'), 0) AS recovered_atomic
          FROM spend_events GROUP BY network
        ),
        ranked AS (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY dimension
            ORDER BY (authorized_atomic + settled_atomic + recovered_atomic) DESC, event_count DESC, key ASC
          ) AS row_number
          FROM aggregated
        )
        SELECT * FROM ranked
        WHERE row_number <= 12
        ORDER BY dimension ASC, row_number ASC
      `,
      this.sql<Record<string, unknown>[]>`
        SELECT t.status AS key, INITCAP(t.status) AS label, COUNT(*)::int AS event_count
        FROM tasks t
        WHERE t.owner = ${owner}
          AND t.created_at_unix >= ${from}::bigint
          AND t.created_at_unix <= ${to}::bigint
        GROUP BY t.status
        ORDER BY event_count DESC, t.status ASC
      `,
    ]);

    const task = taskRows[0] ?? {};
    const flow = flowRows[0] ?? {};
    const spend = spendRows[0] ?? {};
    const latency = latencyRows[0] ?? {};
    const successful = count(task.successful);
    const failed = count(task.failed);
    const resolved = successful + failed;
    const totalCalls = count(flow.total);
    const failedCalls = count(flow.failed);

    const series: AnalyticsSeriesPoint[] = seriesRows.map((row) => ({
      bucketStartUnixSeconds: text(row.bucket_start),
      authorizedAtomic: text(row.authorized_atomic),
      settledAtomic: text(row.settled_atomic),
      recoveredAtomic: text(row.recovered_atomic),
      failures: count(row.failures),
    }));

    const dimensions: Record<string, AnalyticsMoneyBreakdown[]> = {
      task: [],
      provider: [],
      protocol: [],
      network: [],
    };
    for (const row of breakdownRows) {
      const dimension = text(row.dimension, "");
      if (dimensions[dimension]) dimensions[dimension].push(mapBreakdown(row));
    }

    const statuses: AnalyticsStatusBreakdown[] = statusRows.map((row) => ({
      key: text(row.key, "unknown"),
      label: text(row.label, "Unknown"),
      count: count(row.event_count),
    }));

    const averageSettlement = maybeText(latency.average_settlement_seconds);
    const averageRecovery = maybeText(latency.average_recovery_seconds);

    return {
      generatedAtUnixSeconds: String(Math.floor(Date.now() / 1000)),
      range: {
        preset: range.preset,
        fromUnixSeconds: range.fromUnixSeconds.toString(),
        toUnixSeconds: range.toUnixSeconds.toString(),
        bucketSeconds: range.bucketSeconds,
      },
      tasks: {
        total: count(task.total),
        active: count(task.active),
        completed: count(task.completed),
        cancelled: count(task.cancelled),
        successful,
        failed,
        budgetAtomic: text(task.budget_atomic),
      },
      calls: {
        total: totalCalls,
        failed: failedCalls,
      },
      spend: {
        authorizedAtomic: text(spend.authorized_atomic),
        settledAtomic: text(spend.settled_atomic),
        recoveredAtomic: text(spend.recovered_atomic),
      },
      rates: {
        taskSuccessPercent: percent(successful, resolved),
        taskFailurePercent: percent(failed, resolved),
        callFailurePercent: percent(failedCalls, totalCalls),
      },
      latency: {
        ...(averageSettlement !== undefined ? { averageSettlementSeconds: Math.round(Number(averageSettlement)) } : {}),
        ...(averageRecovery !== undefined ? { averageRecoverySeconds: Math.round(Number(averageRecovery)) } : {}),
      },
      series,
      breakdowns: {
        tasks: dimensions.task,
        providers: dimensions.provider,
        protocols: dimensions.protocol,
        networks: dimensions.network,
        statuses,
      },
    };
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
