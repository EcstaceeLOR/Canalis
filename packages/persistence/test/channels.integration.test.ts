import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CanalisApplication } from "@canalis/application";
import { migrateDatabase } from "../src/migrate.js";
import { PostgresCanalisRepository } from "../src/postgres.js";
import { PostgresChannelWorkspaceRepository } from "../src/channels.js";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;

dbDescribe("channel workspace persistence", () => {
  let core: PostgresCanalisRepository;
  let workspace: PostgresChannelWorkspaceRepository;
  let application: CanalisApplication;
  const owner = `channel-owner-${Date.now()}`;
  const otherOwner = `${owner}-other`;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    core = new PostgresCanalisRepository(databaseUrl!);
    workspace = new PostgresChannelWorkspaceRepository(databaseUrl!);
    application = new CanalisApplication(core, () => 2_000_000_000n);
    await application.createTask({ owner, agentId: "channel-workspace-agent", budgetUsd: "1.00", maxPerCallUsd: "0.25", allowedProviders: ["search", "data"] });
    await application.createTask({ owner: otherOwner, agentId: "private-agent", budgetUsd: "1.00", maxPerCallUsd: "0.25", allowedProviders: ["search"] });
  });

  afterAll(async () => {
    await workspace.close();
    await core.close();
  });

  it("discovers every wallet-owned channel without leaking another payer", async () => {
    const result = await workspace.listChannels({ owner, status: "all", page: 1, pageSize: 25 }, 2_000_000_001n);
    expect(result.total).toBe(2);
    expect(result.channels.map((channel) => channel.providerId).sort()).toEqual(["data", "search"]);
    expect(result.channels.every((channel) => channel.payer === owner)).toBe(true);
    expect(result.counts.reserved).toBe(2);
  });

  it("filters by canonical status, provider and search", async () => {
    const reserved = await workspace.listChannels({ owner, status: "reserved", providerId: "search", search: "channel-workspace", page: 1, pageSize: 25 }, 2_000_000_001n);
    expect(reserved.total).toBe(1);
    expect(reserved.channels[0]?.providerId).toBe("search");
    expect(reserved.channels[0]?.nextAction).toBeNull();
  });
});
