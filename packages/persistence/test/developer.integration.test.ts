import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { migrateDatabase, PostgresDeveloperRepository } from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;

dbDescribe("developer platform persistence", () => {
  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    const sql = postgres(databaseUrl!, { max: 1, prepare: false });
    await sql.unsafe("TRUNCATE webhook_deliveries, webhook_events, webhook_subscriptions, developer_api_keys, audit_events RESTART IDENTITY CASCADE");
    await sql.end({ timeout: 5 });
  });

  it("stores API keys by hash, rotates them, revokes them, and isolates wallets", async () => {
    const repo = new PostgresDeveloperRepository(databaseUrl!);
    const wallet = "wallet_developer_a";
    const created = await repo.createApiKey({
      id: "key_a", ownerWallet: wallet, name: "Agent backend", prefix: "cnl_sbx_aaaa", tokenHash: "hash_a",
      scopes: ["tasks:read", "tasks:write"], environment: "sandbox",
    });
    expect(created.prefix).toBe("cnl_sbx_aaaa");
    expect((created as unknown as Record<string, unknown>).tokenHash).toBeUndefined();
    expect((await repo.authenticateApiKey("hash_a"))?.ownerWallet).toBe(wallet);
    expect(await repo.listApiKeys("wallet_developer_b")).toEqual([]);

    const rotated = await repo.rotateApiKey({ id: "key_a", ownerWallet: wallet, prefix: "cnl_sbx_bbbb", tokenHash: "hash_b" });
    expect(rotated?.prefix).toBe("cnl_sbx_bbbb");
    expect(await repo.authenticateApiKey("hash_a")).toBeNull();
    expect((await repo.authenticateApiKey("hash_b"))?.id).toBe("key_a");
    expect(await repo.revokeApiKey("key_a", wallet)).toBe(true);
    expect(await repo.authenticateApiKey("hash_b")).toBeNull();
    await repo.close();
  });

  it("keeps webhook secrets private while persisting retry-observable deliveries", async () => {
    const repo = new PostgresDeveloperRepository(databaseUrl!);
    const wallet = "wallet_webhook_a";
    const subscription = await repo.createWebhook({
      id: "wh_a", ownerWallet: wallet, url: "https://example.com/canalis", description: "events",
      events: ["task.created", "settlement.completed"],
      secretEnvelope: { version: "v1", iv: "iv", ciphertext: "cipher", tag: "tag" },
    });
    expect(subscription.id).toBe("wh_a");
    expect((subscription as unknown as Record<string, unknown>).secretEnvelope).toBeUndefined();
    expect((await repo.listWebhooks(wallet))[0]?.events).toContain("task.created");
    expect((await repo.matchingWebhooks(wallet, "payment.authorized"))).toHaveLength(0);
    expect((await repo.matchingWebhooks(wallet, "task.created"))[0]?.secretEnvelope.ciphertext).toBe("cipher");

    const event = await repo.createWebhookEvent({ id: "evt_a", ownerWallet: wallet, eventType: "task.created", payload: { taskId: "task_a" } });
    expect(event.payload.taskId).toBe("task_a");
    await repo.createDelivery({ id: "whd_a", eventId: "evt_a", subscriptionId: "wh_a", attempt: 1 });
    await repo.finishDelivery({ id: "whd_a", succeeded: false, errorCode: "HTTP_500", responseStatus: 500, nextAttemptAt: new Date(Date.now() + 60_000) });
    const deliveries = await repo.listDeliveries(wallet);
    expect(deliveries[0]).toMatchObject({ id: "whd_a", status: "failed", attempt: 1, errorCode: "HTTP_500" });
    expect((await repo.getDelivery("whd_a", "other_wallet"))).toBeNull();
    expect((await repo.getDelivery("whd_a", wallet))?.event.id).toBe("evt_a");
    await repo.close();
  });
});
