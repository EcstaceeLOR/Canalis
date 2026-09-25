import { randomUUID } from "node:crypto";
import {
  channelActionFor,
  productErrorDescriptor,
  type ActivityActionKind,
  type ActivityCategory,
  type ActivityListQuery,
  type ActivityListResult,
  type ActivityRecord,
  type ActivitySeverity,
  type ActivityState,
} from "@canalis/application";
import postgres, { type Sql } from "postgres";

type ActivityUpsert = {
  fingerprint: string;
  sourceVersion: string;
  category: ActivityCategory;
  severity: ActivitySeverity;
  state: ActivityState;
  title: string;
  message: string;
  guidance?: string;
  errorCode?: string;
  taskId?: string;
  providerId?: string;
  channelAddress?: string;
  transactionSignature?: string;
  actionKind?: ActivityActionKind;
  actionLabel?: string;
  actionHref?: string;
  managedIncident?: boolean;
};

function unix(value: unknown): string {
  if (value === null || value === undefined) return "0";
  if (value instanceof Date) return String(Math.floor(value.getTime() / 1000));
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return String(Math.floor(numeric));
  const date = new Date(String(value));
  return String(Math.floor(date.getTime() / 1000));
}

function record(row: Record<string, unknown>): ActivityRecord {
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    sourceVersion: String(row.source_version),
    category: String(row.category) as ActivityCategory,
    severity: String(row.severity) as ActivitySeverity,
    state: String(row.state) as ActivityState,
    title: String(row.title),
    message: String(row.message),
    ...(row.guidance ? { guidance: String(row.guidance) } : {}),
    ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
    ...(row.task_id ? { taskId: String(row.task_id) } : {}),
    ...(row.provider_id ? { providerId: String(row.provider_id) } : {}),
    ...(row.channel_address ? { channelAddress: String(row.channel_address) } : {}),
    ...(row.transaction_signature ? { transactionSignature: String(row.transaction_signature) } : {}),
    actionKind: String(row.action_kind ?? "none") as ActivityActionKind,
    ...(row.action_label ? { actionLabel: String(row.action_label) } : {}),
    ...(row.action_href ? { actionHref: String(row.action_href) } : {}),
    occurrenceCount: Number(row.occurrence_count ?? 1),
    read: Boolean(row.read_at),
    firstSeenAtUnixSeconds: unix(row.first_seen_at),
    lastSeenAtUnixSeconds: unix(row.last_seen_at),
    ...(row.resolved_at ? { resolvedAtUnixSeconds: unix(row.resolved_at) } : {}),
  };
}

function sourceDate(value: unknown): string {
  if (value instanceof Date) return String(value.getTime());
  if (value === null || value === undefined) return "0";
  return String(value);
}

export class PostgresActivityRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 5, prepare: false });
  }

  private async upsert(ownerWallet: string, input: ActivityUpsert): Promise<void> {
    const metadata = { managedIncident: Boolean(input.managedIncident) };
    await this.sql`
      INSERT INTO activity_events (
        id, owner_wallet, fingerprint, source_version, category, severity, state,
        title, message, guidance, error_code, task_id, provider_id, channel_address,
        transaction_signature, action_kind, action_label, action_href, metadata,
        occurrence_count, first_seen_at, last_seen_at, resolved_at
      ) VALUES (
        ${`activity_${randomUUID()}`}, ${ownerWallet}, ${input.fingerprint}, ${input.sourceVersion},
        ${input.category}, ${input.severity}, ${input.state}, ${input.title}, ${input.message},
        ${input.guidance ?? null}, ${input.errorCode ?? null}, ${input.taskId ?? null},
        ${input.providerId ?? null}, ${input.channelAddress ?? null}, ${input.transactionSignature ?? null},
        ${input.actionKind ?? "none"}, ${input.actionLabel ?? null}, ${input.actionHref ?? null},
        ${this.sql.json(metadata)}, 1, NOW(), NOW(), ${input.state === "resolved" ? this.sql`NOW()` : null}
      )
      ON CONFLICT (owner_wallet, fingerprint) DO UPDATE SET
        source_version = EXCLUDED.source_version,
        category = EXCLUDED.category,
        severity = EXCLUDED.severity,
        state = EXCLUDED.state,
        title = EXCLUDED.title,
        message = EXCLUDED.message,
        guidance = EXCLUDED.guidance,
        error_code = EXCLUDED.error_code,
        task_id = EXCLUDED.task_id,
        provider_id = EXCLUDED.provider_id,
        channel_address = EXCLUDED.channel_address,
        transaction_signature = EXCLUDED.transaction_signature,
        action_kind = EXCLUDED.action_kind,
        action_label = EXCLUDED.action_label,
        action_href = EXCLUDED.action_href,
        metadata = EXCLUDED.metadata,
        occurrence_count = activity_events.occurrence_count +
          CASE WHEN activity_events.source_version IS DISTINCT FROM EXCLUDED.source_version THEN 1 ELSE 0 END,
        last_seen_at = CASE
          WHEN activity_events.source_version IS DISTINCT FROM EXCLUDED.source_version THEN NOW()
          ELSE activity_events.last_seen_at
        END,
        read_at = CASE
          WHEN activity_events.source_version IS DISTINCT FROM EXCLUDED.source_version AND EXCLUDED.state = 'open' THEN NULL
          ELSE activity_events.read_at
        END,
        resolved_at = CASE
          WHEN EXCLUDED.state = 'resolved' THEN COALESCE(activity_events.resolved_at, NOW())
          ELSE NULL
        END
    `;
  }

  private async resolveMissingManagedIncidents(ownerWallet: string, active: Set<string>): Promise<void> {
    const rows = await this.sql<{ id: string; fingerprint: string }[]>`
      SELECT id, fingerprint
      FROM activity_events
      WHERE owner_wallet = ${ownerWallet}
        AND state = 'open'
        AND metadata->>'managedIncident' = 'true'
    `;
    for (const row of rows) {
      if (active.has(row.fingerprint)) continue;
      await this.sql`
        UPDATE activity_events
        SET state = 'resolved', resolved_at = COALESCE(resolved_at, NOW())
        WHERE id = ${row.id} AND owner_wallet = ${ownerWallet}
      `;
    }
  }

  async synchronizeOperationalActivity(ownerWallet: string): Promise<void> {
    const active = new Set<string>();
    const now = BigInt(Math.floor(Date.now() / 1000));

    const providers = await this.sql<Record<string, unknown>[]>`
      SELECT id, name, protocol, status, health_status, last_health_check_at_unix,
             last_error_at_unix, last_error_code, created_at, updated_at
      FROM providers
      WHERE owner_wallet = ${ownerWallet}
      ORDER BY updated_at DESC
    `;
    for (const provider of providers) {
      const providerId = String(provider.id);
      const providerName = String(provider.name);
      await this.upsert(ownerWallet, {
        fingerprint: `provider:${providerId}:configured`,
        sourceVersion: sourceDate(provider.created_at),
        category: "integration",
        severity: "info",
        state: "resolved",
        title: `${providerName} integration configured`,
        message: `${String(provider.protocol).toUpperCase()} provider configuration is available to this wallet.`,
        providerId,
        actionKind: "retest-provider",
        actionLabel: "Test connection",
        actionHref: `/providers?q=${encodeURIComponent(providerId)}`,
      });

      if (provider.status !== "active") continue;
      if (provider.health_status === "unhealthy") {
        const fingerprint = `provider:${providerId}:unhealthy`;
        active.add(fingerprint);
        const code = typeof provider.last_error_code === "string" ? provider.last_error_code : "PROVIDER_UNHEALTHY";
        const descriptor = productErrorDescriptor(code);
        await this.upsert(ownerWallet, {
          fingerprint,
          sourceVersion: String(provider.last_error_at_unix ?? provider.last_health_check_at_unix ?? provider.updated_at),
          category: "provider",
          severity: descriptor.severity,
          state: "open",
          title: `${providerName}: ${descriptor.title}`,
          message: descriptor.message,
          guidance: descriptor.guidance,
          errorCode: code,
          providerId,
          actionKind: "retest-provider",
          actionLabel: "Retest provider",
          actionHref: `/providers?q=${encodeURIComponent(providerId)}`,
          managedIncident: true,
        });
      }

      const checked = provider.last_health_check_at_unix === null ? 0n : BigInt(String(provider.last_health_check_at_unix));
      if (checked === 0n || checked < now - 86_400n) {
        const fingerprint = `provider:${providerId}:stale`;
        active.add(fingerprint);
        await this.upsert(ownerWallet, {
          fingerprint,
          sourceVersion: String(provider.last_health_check_at_unix ?? provider.updated_at),
          category: "integration",
          severity: "warning",
          state: "open",
          title: `${providerName} health verification is stale`,
          message: "This active integration has not passed a recent connection check.",
          guidance: "Retest the provider before relying on it for a new autonomous payment task.",
          errorCode: "PROVIDER_UNHEALTHY",
          providerId,
          actionKind: "retest-provider",
          actionLabel: "Test connection",
          actionHref: `/providers?q=${encodeURIComponent(providerId)}`,
          managedIncident: true,
        });
      }
    }

    const latestFlows = await this.sql<Record<string, unknown>[]>`
      SELECT DISTINCT ON (f.task_id, f.provider_id)
             f.id, f.task_id, f.provider_id, f.status, f.rejection_code, f.created_at_unix,
             p.name AS provider_name
      FROM flows f
      JOIN tasks t ON t.id = f.task_id
      JOIN providers p ON p.id = f.provider_id
      WHERE t.owner = ${ownerWallet}
      ORDER BY f.task_id, f.provider_id, f.created_at_unix DESC
    `;
    for (const flow of latestFlows) {
      if (!['failed', 'rejected'].includes(String(flow.status))) continue;
      const taskId = String(flow.task_id);
      const providerId = String(flow.provider_id);
      const fingerprint = `task:${taskId}:provider:${providerId}:failure`;
      active.add(fingerprint);
      const code = typeof flow.rejection_code === "string" && flow.rejection_code
        ? String(flow.rejection_code)
        : "PROVIDER_EXECUTION_FAILED";
      const descriptor = productErrorDescriptor(code);
      await this.upsert(ownerWallet, {
        fingerprint,
        sourceVersion: String(flow.id),
        category: "task",
        severity: descriptor.severity,
        state: "open",
        title: `${String(flow.provider_name)} call failed`,
        message: descriptor.message,
        guidance: descriptor.guidance,
        errorCode: code,
        taskId,
        providerId,
        actionKind: "open-task",
        actionLabel: "Inspect task",
        actionHref: `/tasks/${encodeURIComponent(taskId)}`,
        managedIncident: true,
      });
    }

    const channels = await this.sql<Record<string, unknown>[]>`
      SELECT c.task_id, c.provider_id, c.channel_address, c.status, c.ceiling_atomic,
             c.cumulative_authorized_atomic, c.recovery_state, c.updated_at_unix,
             c.open_transaction_signature, c.settle_transaction_signature,
             c.distribution_transaction_signature, c.refund_transaction_signature,
             t.status AS task_status, t.expires_at_unix, p.name AS provider_name
      FROM channels c
      JOIN tasks t ON t.id = c.task_id
      JOIN providers p ON p.id = c.provider_id
      WHERE t.owner = ${ownerWallet}
      ORDER BY c.updated_at_unix DESC
    `;
    for (const channel of channels) {
      const taskId = String(channel.task_id);
      const providerId = String(channel.provider_id);
      const channelAddress = channel.channel_address ? String(channel.channel_address) : undefined;
      const recoveryState = channel.recovery_state && typeof channel.recovery_state === "object"
        ? channel.recovery_state as Record<string, unknown>
        : {};
      const recoveryStage = typeof recoveryState.stage === "string" ? recoveryState.stage : undefined;
      const automaticRetryBlocked = recoveryState.automaticRetryBlocked === true;
      const authorized = BigInt(String(channel.cumulative_authorized_atomic));
      const ceiling = BigInt(String(channel.ceiling_atomic));
      const nextAction = channelActionFor({
        status: String(channel.status),
        taskStatus: String(channel.task_status),
        cumulativeAuthorizedAtomic: authorized,
        expiresAtUnixSeconds: BigInt(String(channel.expires_at_unix)),
        nowUnixSeconds: now,
        ...(recoveryStage ? { recoveryStage } : {}),
        automaticRetryBlocked,
      });

      if (nextAction === "inspect") {
        const fingerprint = `channel:${taskId}:${providerId}:recovery`;
        active.add(fingerprint);
        const descriptor = productErrorDescriptor(
          recoveryStage === "finalization-ambiguous" ? "CHANNEL_FINALIZATION_AMBIGUOUS" : "CHANNEL_RECOVERY_REQUIRED",
        );
        await this.upsert(ownerWallet, {
          fingerprint,
          sourceVersion: `${String(channel.updated_at_unix)}:${recoveryStage ?? String(channel.status)}`,
          category: "recovery",
          severity: "critical",
          state: "open",
          title: `${String(channel.provider_name)} channel requires reconciliation`,
          message: descriptor.message,
          guidance: descriptor.guidance,
          errorCode: recoveryStage === "finalization-ambiguous" ? "CHANNEL_FINALIZATION_AMBIGUOUS" : "CHANNEL_RECOVERY_REQUIRED",
          taskId,
          providerId,
          ...(channelAddress ? { channelAddress } : {}),
          actionKind: "inspect-channel",
          actionLabel: "Inspect recovery",
          actionHref: `/channels?q=${encodeURIComponent(taskId)}`,
          managedIncident: true,
        });
      } else if ((nextAction === "recover" || nextAction === "finalize") && ceiling > authorized) {
        const fingerprint = `channel:${taskId}:${providerId}:recoverable`;
        active.add(fingerprint);
        await this.upsert(ownerWallet, {
          fingerprint,
          sourceVersion: String(channel.updated_at_unix),
          category: "recovery",
          severity: "warning",
          state: "open",
          title: nextAction === "recover" ? "Unused channel escrow is recoverable" : "Channel is ready to finalize",
          message: nextAction === "recover"
            ? "This channel has no authorized provider spend and its unused escrow can be returned safely."
            : "Authorized provider spend can be settled and the unused channel remainder returned in the terminal action.",
          guidance: nextAction === "recover"
            ? "Recover the unused escrow to the payer wallet."
            : "Finalize the channel once you are ready to settle the authorized cumulative amount.",
          taskId,
          providerId,
          ...(channelAddress ? { channelAddress } : {}),
          actionKind: nextAction === "recover" ? "recover-channel" : "finalize-channel",
          actionLabel: nextAction === "recover" ? "Recover unused escrow" : "Finalize channel",
          actionHref: `/channels?q=${encodeURIComponent(taskId)}`,
          managedIncident: true,
        });
      }

      const lifecycle: Array<{ kind: "channel" | "settlement" | "recovery"; signature: unknown; title: string; message: string }> = [
        { kind: "channel", signature: channel.open_transaction_signature, title: "Payment channel opened", message: `${String(channel.provider_name)} channel was opened on Solana.` },
        { kind: "settlement", signature: channel.settle_transaction_signature, title: "Channel settlement confirmed", message: `${String(channel.provider_name)} cumulative authorization was finalized on Solana.` },
        { kind: "settlement", signature: channel.distribution_transaction_signature, title: "Provider distribution confirmed", message: `${String(channel.provider_name)} distribution has on-chain evidence.` },
        { kind: "recovery", signature: channel.refund_transaction_signature, title: "Unused escrow recovered", message: `${String(channel.provider_name)} channel remainder was returned to the payer.` },
      ];
      for (const item of lifecycle) {
        if (!item.signature) continue;
        const signature = String(item.signature);
        await this.upsert(ownerWallet, {
          fingerprint: `${item.kind}:${taskId}:${providerId}:${signature}`,
          sourceVersion: signature,
          category: item.kind,
          severity: "success",
          state: "resolved",
          title: item.title,
          message: item.message,
          taskId,
          providerId,
          ...(channelAddress ? { channelAddress } : {}),
          transactionSignature: signature,
          actionKind: "open-transaction",
          actionLabel: "View transaction",
          actionHref: `/transactions?q=${encodeURIComponent(signature)}`,
        });
      }
    }

    const tasks = await this.sql<Record<string, unknown>[]>`
      SELECT id, created_at_unix, status
      FROM tasks
      WHERE owner = ${ownerWallet}
      ORDER BY created_at_unix DESC
      LIMIT 100
    `;
    for (const task of tasks) {
      const taskId = String(task.id);
      await this.upsert(ownerWallet, {
        fingerprint: `task:${taskId}:created`,
        sourceVersion: String(task.created_at_unix),
        category: "task",
        severity: "info",
        state: "resolved",
        title: "Task created",
        message: "A governed Canalis task was persisted for this wallet.",
        taskId,
        actionKind: "open-task",
        actionLabel: "Open task",
        actionHref: `/tasks/${encodeURIComponent(taskId)}`,
      });
    }

    await this.resolveMissingManagedIncidents(ownerWallet, active);
  }

  async list(ownerWallet: string, query: ActivityListQuery): Promise<ActivityListResult> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM activity_events
      WHERE owner_wallet = ${ownerWallet}
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               CASE state WHEN 'open' THEN 0 ELSE 1 END,
               last_seen_at DESC
      LIMIT 1000
    `;
    const all = rows.map(record);
    const filtered = all.filter((event) => {
      if (query.categories?.length && !query.categories.includes(event.category)) return false;
      if (query.severities?.length && !query.severities.includes(event.severity)) return false;
      if (query.state && event.state !== query.state) return false;
      if (query.unreadOnly && event.read) return false;
      return true;
    });
    const offset = (query.page - 1) * query.pageSize;
    const totalPages = Math.max(1, Math.ceil(filtered.length / query.pageSize));
    return {
      events: filtered.slice(offset, offset + query.pageSize),
      total: filtered.length,
      unreadCount: all.filter((event) => !event.read).length,
      openCount: all.filter((event) => event.state === "open").length,
      criticalCount: all.filter((event) => event.state === "open" && event.severity === "critical").length,
      page: query.page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  async markRead(ownerWallet: string, eventId: string, read: boolean): Promise<ActivityRecord | null> {
    const rows = await this.sql<Record<string, unknown>[]>`
      UPDATE activity_events
      SET read_at = ${read ? this.sql`NOW()` : null}
      WHERE id = ${eventId} AND owner_wallet = ${ownerWallet}
      RETURNING *
    `;
    return rows[0] ? record(rows[0]) : null;
  }

  async markAllRead(ownerWallet: string): Promise<number> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE activity_events
      SET read_at = NOW()
      WHERE owner_wallet = ${ownerWallet} AND read_at IS NULL
      RETURNING id
    `;
    return rows.length;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
