import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { migrateDatabase, PostgresWalletAuthRepository } from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;

dbDescribe("wallet auth persistence", () => {
  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    const sql = postgres(databaseUrl!, { max: 1, prepare: false });
    await sql.unsafe("TRUNCATE wallet_sessions, wallet_auth_challenges");
    await sql.end({ timeout: 5 });
  });

  it("persists one-time challenges and revocable sessions", async () => {
    const repository = new PostgresWalletAuthRepository(databaseUrl!);
    await repository.createChallenge({
      id: "challenge_integration",
      walletAddress: "11111111111111111111111111111111",
      domain: "canalis.example",
      network: "solana:devnet",
      message: "integration challenge",
      createdAtUnixSeconds: 100n,
      expiresAtUnixSeconds: 200n,
    });

    const challenge = await repository.getChallenge("challenge_integration");
    expect(challenge?.walletAddress).toBe("11111111111111111111111111111111");
    expect(await repository.consumeChallenge("challenge_integration", challenge!.walletAddress, 120n)).toBe(true);
    expect(await repository.consumeChallenge("challenge_integration", challenge!.walletAddress, 121n)).toBe(false);

    await repository.createSession({
      tokenHash: "hash_integration",
      walletAddress: challenge!.walletAddress,
      network: "solana:devnet",
      createdAtUnixSeconds: 120n,
      expiresAtUnixSeconds: 500n,
      lastSeenAtUnixSeconds: 120n,
    });
    await repository.touchSession("hash_integration", 130n);
    expect((await repository.getSession("hash_integration"))?.lastSeenAtUnixSeconds).toBe(130n);
    await repository.revokeSession("hash_integration", 140n);
    expect((await repository.getSession("hash_integration"))?.revokedAtUnixSeconds).toBe(140n);
    await repository.close();
  });
});
