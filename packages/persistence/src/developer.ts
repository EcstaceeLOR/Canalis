import type {
  DeveloperApiKeyRecord,
  DeveloperApiScope,
  DeveloperEnvironment,
  WebhookDeliveryRecord,
  WebhookEventType,
  WebhookSubscriptionRecord,
} from "@canalis/application";
import postgres, { type Sql } from "postgres";

export type StoredWebhookSubscription = WebhookSubscriptionRecord & { secretEnvelope: Record<string, unknown> };
export type StoredWebhookEvent = {
  id: string;
  ownerWallet: string;
  eventType: WebhookEventType;
  apiVersion: string;
  payload: Record<string, unknown>;
  createdAtUnixSeconds: string;
};

function unix(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : String(Math.floor(date.getTime() / 1000));
}

function jsonSafe(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function apiKey(row: Record<string, unknown>): DeveloperApiKeyRecord {
  const result: DeveloperApiKeyRecord = {
    id: String(row.id),
    ownerWallet: String(row.owner_wallet),
    name: String(row.name),
    prefix: String(row.token_prefix),
    scopes: (Array.isArray(row.scopes) ? row.scopes : []) as DeveloperApiScope[],
    environment: String(row.environment) as DeveloperEnvironment,
    status: String(row.status) as DeveloperApiKeyRecord["status"],
    createdAtUnixSeconds: unix(row.created_at) ?? "0",
    updatedAtUnixSeconds: unix(row.updated_at) ?? "0",
  };
  const lastUsed = unix(row.last_used_at);
  const expires = unix(row.expires_at);
  const revoked = unix(row.revoked_at);
  if (lastUsed) result.lastUsedAtUnixSeconds = lastUsed;
  if (expires) result.expiresAtUnixSeconds = expires;
  if (revoked) result.revokedAtUnixSeconds = revoked;
  return result;
}

function webhook(row: Record<string, unknown>): StoredWebhookSubscription {
  const result: StoredWebhookSubscription = {
    id: String(row.id),
    ownerWallet: String(row.owner_wallet),
    url: String(row.url),
    description: String(row.description ?? ""),
    events: (Array.isArray(row.events) ? row.events : []) as WebhookEventType[],
    enabled: Boolean(row.enabled),
    secretEnvelope: (row.secret_envelope && typeof row.secret_envelope === "object" && !Array.isArray(row.secret_envelope))
      ? row.secret_envelope as Record<string, unknown>
      : {},
    createdAtUnixSeconds: unix(row.created_at) ?? "0",
    updatedAtUnixSeconds: unix(row.updated_at) ?? "0",
  };
  const success = unix(row.last_success_at);
  const failure = unix(row.last_failure_at);
  if (success) result.lastSuccessAtUnixSeconds = success;
  if (failure) result.lastFailureAtUnixSeconds = failure;
  return result;
}

function delivery(row: Record<string, unknown>): WebhookDeliveryRecord {
  const result: WebhookDeliveryRecord = {
    id: String(row.id),
    eventId: String(row.event_id),
    subscriptionId: String(row.subscription_id),
    eventType: String(row.event_type) as WebhookEventType,
    status: String(row.status) as WebhookDeliveryRecord["status"],
    attempt: Number(row.attempt),
    createdAtUnixSeconds: unix(row.created_at) ?? "0",
  };
  if (row.response_status !== null && row.response_status !== undefined) result.responseStatus = Number(row.response_status);
  if (row.error_code) result.errorCode = String(row.error_code);
  const delivered = unix(row.delivered_at);
  const next = unix(row.next_attempt_at);
  if (delivered) result.deliveredAtUnixSeconds = delivered;
  if (next) result.nextAttemptAtUnixSeconds = next;
  return result;
}

export class PostgresDeveloperRepository {
  private readonly sql: Sql;
  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 5, prepare: false });
  }

  async createApiKey(input: {
    id: string; ownerWallet: string; name: string; prefix: string; tokenHash: string;
    scopes: DeveloperApiScope[]; environment: DeveloperEnvironment; expiresAtUnixSeconds?: number;
  }): Promise<DeveloperApiKeyRecord> {
    const rows = await this.sql<Record<string, unknown>[]>`
      INSERT INTO developer_api_keys (id, owner_wallet, name, token_prefix, token_hash, scopes, environment, expires_at)
      VALUES (
        ${input.id}, ${input.ownerWallet}, ${input.name}, ${input.prefix}, ${input.tokenHash},
        ${this.sql.json(input.scopes)}, ${input.environment},
        ${input.expiresAtUnixSeconds ? new Date(input.expiresAtUnixSeconds * 1000) : null}
      )
      RETURNING *
    `;
    return apiKey(rows[0]!);
  }

  async listApiKeys(ownerWallet: string): Promise<DeveloperApiKeyRecord[]> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM developer_api_keys WHERE owner_wallet = ${ownerWallet} ORDER BY created_at DESC
    `;
    return rows.map(apiKey);
  }

  async authenticateApiKey(tokenHash: string): Promise<DeveloperApiKeyRecord | null> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM developer_api_keys
      WHERE token_hash = ${tokenHash} AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1
    `;
    if (!rows[0]) return null;
    await this.sql`UPDATE developer_api_keys SET last_used_at = NOW(), updated_at = NOW() WHERE id = ${String(rows[0].id)}`;
    return apiKey({ ...rows[0], last_used_at: new Date(), updated_at: new Date() });
  }

  async revokeApiKey(id: string, ownerWallet: string): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE developer_api_keys SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND owner_wallet = ${ownerWallet} AND status = 'active'
      RETURNING id
    `;
    return rows.length > 0;
  }

  async rotateApiKey(input: { id: string; ownerWallet: string; prefix: string; tokenHash: string }): Promise<DeveloperApiKeyRecord | null> {
    const rows = await this.sql<Record<string, unknown>[]>`
      UPDATE developer_api_keys
      SET token_prefix = ${input.prefix}, token_hash = ${input.tokenHash}, last_used_at = NULL,
          revoked_at = NULL, status = 'active', updated_at = NOW()
      WHERE id = ${input.id} AND owner_wallet = ${input.ownerWallet}
      RETURNING *
    `;
    return rows[0] ? apiKey(rows[0]) : null;
  }

  async createWebhook(input: {
    id: string; ownerWallet: string; url: string; description: string; events: WebhookEventType[];
    secretEnvelope: Record<string, unknown>;
  }): Promise<WebhookSubscriptionRecord> {
    const rows = await this.sql<Record<string, unknown>[]>`
      INSERT INTO webhook_subscriptions (id, owner_wallet, url, description, events, secret_envelope)
      VALUES (${input.id}, ${input.ownerWallet}, ${input.url}, ${input.description}, ${this.sql.json(input.events)}, ${this.sql.json(jsonSafe(input.secretEnvelope))})
      RETURNING *
    `;
    const { secretEnvelope: _secret, ...safe } = webhook(rows[0]!);
    return safe;
  }

  async listWebhooks(ownerWallet: string): Promise<WebhookSubscriptionRecord[]> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM webhook_subscriptions WHERE owner_wallet = ${ownerWallet} ORDER BY created_at DESC
    `;
    return rows.map((row) => {
      const { secretEnvelope: _secret, ...safe } = webhook(row);
      return safe;
    });
  }

  async getWebhook(id: string, ownerWallet: string): Promise<StoredWebhookSubscription | null> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM webhook_subscriptions WHERE id = ${id} AND owner_wallet = ${ownerWallet} LIMIT 1
    `;
    return rows[0] ? webhook(rows[0]) : null;
  }

  async updateWebhook(input: {
    id: string; ownerWallet: string; url?: string; description?: string; events?: WebhookEventType[]; enabled?: boolean;
  }): Promise<WebhookSubscriptionRecord | null> {
    const current = await this.getWebhook(input.id, input.ownerWallet);
    if (!current) return null;
    const rows = await this.sql<Record<string, unknown>[]>`
      UPDATE webhook_subscriptions SET
        url = ${input.url ?? current.url},
        description = ${input.description ?? current.description},
        events = ${this.sql.json(input.events ?? current.events)},
        enabled = ${input.enabled ?? current.enabled},
        updated_at = NOW()
      WHERE id = ${input.id} AND owner_wallet = ${input.ownerWallet}
      RETURNING *
    `;
    const { secretEnvelope: _secret, ...safe } = webhook(rows[0]!);
    return safe;
  }

  async rotateWebhookSecret(id: string, ownerWallet: string, envelope: Record<string, unknown>): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE webhook_subscriptions SET secret_envelope = ${this.sql.json(jsonSafe(envelope))}, updated_at = NOW()
      WHERE id = ${id} AND owner_wallet = ${ownerWallet} RETURNING id
    `;
    return rows.length > 0;
  }

  async matchingWebhooks(ownerWallet: string, eventType: WebhookEventType): Promise<StoredWebhookSubscription[]> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM webhook_subscriptions
      WHERE owner_wallet = ${ownerWallet} AND enabled = TRUE AND events ? ${eventType}
      ORDER BY created_at ASC
    `;
    return rows.map(webhook);
  }

  async createWebhookEvent(input: {
    id: string; ownerWallet: string; eventType: WebhookEventType; payload: Record<string, unknown>;
  }): Promise<StoredWebhookEvent> {
    const rows = await this.sql<Record<string, unknown>[]>`
      INSERT INTO webhook_events (id, owner_wallet, event_type, payload)
      VALUES (${input.id}, ${input.ownerWallet}, ${input.eventType}, ${this.sql.json(jsonSafe(input.payload))})
      ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
      RETURNING *
    `;
    const row = rows[0]!;
    return {
      id: String(row.id), ownerWallet: String(row.owner_wallet), eventType: String(row.event_type) as WebhookEventType,
      apiVersion: String(row.api_version), payload: row.payload as Record<string, unknown>, createdAtUnixSeconds: unix(row.created_at) ?? "0",
    };
  }

  async createDelivery(input: { id: string; eventId: string; subscriptionId: string; attempt: number }): Promise<void> {
    await this.sql`
      INSERT INTO webhook_deliveries (id, event_id, subscription_id, attempt)
      VALUES (${input.id}, ${input.eventId}, ${input.subscriptionId}, ${input.attempt})
      ON CONFLICT (event_id, subscription_id, attempt) DO NOTHING
    `;
  }

  async finishDelivery(input: {
    id: string; succeeded: boolean; responseStatus?: number; errorCode?: string; nextAttemptAt?: Date;
  }): Promise<void> {
    await this.sql`
      UPDATE webhook_deliveries SET
        status = ${input.succeeded ? "succeeded" : "failed"},
        response_status = ${input.responseStatus ?? null}, error_code = ${input.errorCode ?? null},
        delivered_at = ${input.succeeded ? new Date() : null}, next_attempt_at = ${input.nextAttemptAt ?? null}
      WHERE id = ${input.id}
    `;
    await this.sql`
      UPDATE webhook_subscriptions s SET
        last_success_at = CASE WHEN ${input.succeeded} THEN NOW() ELSE last_success_at END,
        last_failure_at = CASE WHEN ${input.succeeded} THEN last_failure_at ELSE NOW() END,
        updated_at = NOW()
      FROM webhook_deliveries d WHERE d.id = ${input.id} AND s.id = d.subscription_id
    `;
  }

  async listDeliveries(ownerWallet: string, subscriptionId?: string, limit = 100): Promise<WebhookDeliveryRecord[]> {
    const rows = subscriptionId
      ? await this.sql<Record<string, unknown>[]>`
          SELECT d.*, e.event_type FROM webhook_deliveries d
          JOIN webhook_events e ON e.id = d.event_id
          JOIN webhook_subscriptions s ON s.id = d.subscription_id
          WHERE s.owner_wallet = ${ownerWallet} AND s.id = ${subscriptionId}
          ORDER BY d.created_at DESC LIMIT ${limit}
        `
      : await this.sql<Record<string, unknown>[]>`
          SELECT d.*, e.event_type FROM webhook_deliveries d
          JOIN webhook_events e ON e.id = d.event_id
          JOIN webhook_subscriptions s ON s.id = d.subscription_id
          WHERE s.owner_wallet = ${ownerWallet}
          ORDER BY d.created_at DESC LIMIT ${limit}
        `;
    return rows.map(delivery);
  }

  async getDelivery(id: string, ownerWallet: string): Promise<{ delivery: WebhookDeliveryRecord; event: StoredWebhookEvent; subscription: StoredWebhookSubscription } | null> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT d.*, e.event_type, e.owner_wallet, e.api_version, e.payload, e.created_at AS event_created_at,
             s.url, s.description, s.events, s.secret_envelope, s.enabled,
             s.created_at AS subscription_created_at, s.updated_at AS subscription_updated_at,
             s.last_success_at, s.last_failure_at
      FROM webhook_deliveries d
      JOIN webhook_events e ON e.id = d.event_id
      JOIN webhook_subscriptions s ON s.id = d.subscription_id
      WHERE d.id = ${id} AND s.owner_wallet = ${ownerWallet} LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      delivery: delivery(row),
      event: {
        id: String(row.event_id), ownerWallet: String(row.owner_wallet), eventType: String(row.event_type) as WebhookEventType,
        apiVersion: String(row.api_version), payload: row.payload as Record<string, unknown>, createdAtUnixSeconds: unix(row.event_created_at) ?? "0",
      },
      subscription: webhook({
        id: row.subscription_id, owner_wallet: row.owner_wallet, url: row.url, description: row.description, events: row.events,
        secret_envelope: row.secret_envelope, enabled: row.enabled, created_at: row.subscription_created_at,
        updated_at: row.subscription_updated_at, last_success_at: row.last_success_at, last_failure_at: row.last_failure_at,
      }),
    };
  }

  async close(): Promise<void> { await this.sql.end({ timeout: 5 }); }
}
