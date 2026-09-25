import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAccountSettings } from "@canalis/application";
import { migrateDatabase } from "../src/migrate.js";
import { PostgresSettingsRepository } from "../src/settings.js";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;

dbDescribe("account settings persistence", () => {
  let repository: PostgresSettingsRepository;
  const ownerA = `settings-a-${Date.now()}`;
  const ownerB = `settings-b-${Date.now()}`;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    repository = new PostgresSettingsRepository(databaseUrl!);
  });

  afterAll(async () => {
    await repository.close();
  });

  it("creates safe devnet defaults per account", async () => {
    const a = await repository.get(ownerA);
    const b = await repository.get(ownerB);
    expect(a.ownerWallet).toBe(ownerA);
    expect(b.ownerWallet).toBe(ownerB);
    expect(a.environment).toBe("devnet");
    expect(a.solanaNetwork).toBe("devnet");
  });

  it("persists preferences without leaking across accounts", async () => {
    const next = parseAccountSettings({
      displayName: "Account A ops",
      environment: "devnet",
      solanaNetwork: "devnet",
      defaultAssetSymbol: "USDC",
      defaultAssetMint: "",
      explorerCluster: "devnet",
      taskDefaults: { agentId: "account-a-agent", executionMode: "x402", defaultPolicyId: "", saveAsDraft: true },
      notifications: { taskFailures: false, providerIncidents: true, settlementFailures: true, recoveryRequired: true },
      product: { autoRefreshSeconds: 60, compactTables: true, showAdvancedMetadata: true },
      mainnetAcknowledged: false,
    }, ownerA);
    const saved = await repository.save(next);
    const other = await repository.get(ownerB);

    expect(saved.displayName).toBe("Account A ops");
    expect(saved.taskDefaults.agentId).toBe("account-a-agent");
    expect(saved.taskDefaults.saveAsDraft).toBe(true);
    expect(saved.product.compactTables).toBe(true);
    expect(other.displayName).toBe("");
    expect(other.taskDefaults.agentId).toBe("canalis-agent");
  });
});
