import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  migrateDatabase,
  PostgresProviderRegistryRepository,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;

dbDescribe("provider registry persistence", () => {
  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    const sql = postgres(databaseUrl!, { max: 1, prepare: false });
    await sql`DELETE FROM providers WHERE id IN ('integration-x402-a', 'integration-x402-b')`;
    await sql.end({ timeout: 5 });
  });

  it("persists wallet-scoped configuration without exposing credential material", async () => {
    const repository = new PostgresProviderRegistryRepository(databaseUrl!);
    const created = await repository.createProvider(
      "wallet-a",
      {
        id: "integration-x402-a",
        name: "Integration x402 A",
        description: "Integration-test paid resource",
        protocol: "x402",
        endpoint: "https://provider.example/resource",
        payee: "payee-a",
        supportedNetworks: ["solana:devnet"],
        supportedAssets: ["USDC"],
        pricingModel: "challenge",
        defaultChannelCeilingUsd: "0.50",
        policyMetadata: { riskTier: "test" },
        credential: {
          kind: "api-key",
          headerName: "x-api-key",
          secret: "never-persist-this-plaintext-value",
        },
      },
      {
        kind: "api-key",
        headerName: "x-api-key",
        envelope: {
          version: 1,
          algorithm: "aes-256-gcm",
          iv: "encrypted-iv",
          tag: "encrypted-tag",
          ciphertext: "encrypted-ciphertext",
        },
      },
    );

    expect(created.ownerWallet).toBe("wallet-a");
    expect(created.systemManaged).toBe(false);
    expect(created.healthStatus).toBe("unknown");
    expect(created.hasCredential).toBe(true);
    expect(created.defaultChannelCeilingAtomic).toBe("500000");
    expect(JSON.stringify(created)).not.toContain("encrypted-ciphertext");
    expect(JSON.stringify(created)).not.toContain("never-persist-this-plaintext-value");

    const walletA = await repository.listProviders("wallet-a");
    const walletB = await repository.listProviders("wallet-b");
    expect(walletA.some((provider) => provider.id === created.id)).toBe(true);
    expect(walletB.some((provider) => provider.id === created.id)).toBe(false);
    expect(walletB.some((provider) => provider.id === "search" && provider.systemManaged)).toBe(true);

    const secret = await repository.getSecretEnvelope(created.id, "wallet-a");
    expect(secret?.envelope.ciphertext).toBe("encrypted-ciphertext");
    await expect(repository.getSecretEnvelope(created.id, "wallet-b")).resolves.toBeNull();

    const healthy = await repository.recordHealth(created.id, "wallet-a", {
      status: "healthy",
      checkedAtUnixSeconds: "1800000100",
      latencyMs: 42,
      message: "x402 challenge verified",
      protocolMetadata: { network: "solana:devnet", asset: "USDC" },
    });
    expect(healthy.healthStatus).toBe("healthy");
    expect(healthy.lastSuccessAtUnixSeconds).toBe("1800000100");

    const disabled = await repository.setStatus(created.id, "wallet-a", "disabled");
    expect(disabled.status).toBe("disabled");
    expect((await repository.listProviders("wallet-a", true)).some((provider) => provider.id === created.id)).toBe(false);

    await repository.close();
  });
});
