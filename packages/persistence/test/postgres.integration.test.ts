import { beforeAll, describe, expect, it } from "vitest";
import { CanalisApplication } from "@canalis/application";
import postgres from "postgres";
import {
  migrateDatabase,
  PostgresCanalisRepository,
  PostgresLiveChannelRepository,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;

dbDescribe("Postgres persistence integration", () => {
  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    const sql = postgres(databaseUrl!, { max: 1, prepare: false });
    await sql.unsafe(
      "TRUNCATE settlements, receipts, flows, channels, policies, tasks RESTART IDENTITY CASCADE",
    );
    await sql.end({ timeout: 5 });
  });

  it("survives a repository restart with task, receipts, channels and recovery state", async () => {
    const repositoryOne = new PostgresCanalisRepository(databaseUrl!);
    const appOne = new CanalisApplication(repositoryOne, () => 1_800_000_000n);
    const created = await appOne.createTask({
      owner: "integration-owner",
      budgetUsd: "1.00",
      maxPerCallUsd: "0.25",
      allowedProviders: ["search", "data", "inference"],
      mode: "deterministic",
    });
    const executed = await appOne.executeTask(created.task.id);
    expect(executed.graph.spentAtomic).toBe("200000");
    expect(executed.graph.remainingAtomic).toBe("800000");
    expect(executed.graph.flows.filter((flow) => flow.receipt).length).toBe(3);
    await repositoryOne.close();

    const repositoryTwo = new PostgresCanalisRepository(databaseUrl!);
    const appTwo = new CanalisApplication(repositoryTwo, () => 1_800_000_100n);
    const restored = await appTwo.getTask(created.task.id);
    expect(restored.task.status).toBe("completed");
    expect(restored.graph.flows).toHaveLength(3);
    expect(restored.channels).toHaveLength(3);

    await appTwo.recordChannelState(created.task.id, "search", {
      channelAddress: "integration-channel-address",
      status: "recovered",
      openTransactionSignature: "integration-open-signature",
      settleTransactionSignature: "integration-settle-signature",
      refundTransactionSignature: "integration-refund-signature",
      recoveryState: { action: "payer-refund", complete: true },
    });
    await repositoryTwo.close();

    const repositoryThree = new PostgresCanalisRepository(databaseUrl!);
    const appThree = new CanalisApplication(repositoryThree);
    const afterSecondRestart = await appThree.getTask(created.task.id);
    const searchChannel = afterSecondRestart.channels.find(
      (channel) => channel.providerId === "search",
    );
    expect(searchChannel?.channelAddress).toBe("integration-channel-address");
    expect(searchChannel?.refundTransactionSignature).toBe(
      "integration-refund-signature",
    );
    expect(searchChannel?.recoveryState).toEqual({
      action: "payer-refund",
      complete: true,
    });
    await repositoryThree.close();
  });

  it("allows only one server instance to acquire a live channel finalization lease", async () => {
    const repository = new PostgresCanalisRepository(databaseUrl!);
    const app = new CanalisApplication(repository, () => 1_800_001_000n);
    const created = await app.createTask({
      owner: "lease-owner",
      budgetUsd: "1.00",
      maxPerCallUsd: "0.25",
      allowedProviders: ["search"],
      mode: "x402",
    });
    await app.recordChannelState(created.task.id, "search", {
      status: "open",
      channelAddress: "lease-channel-address",
      openTransactionSignature: "lease-open-signature",
      recoveryState: { stage: "open" },
    });

    const firstRepository = new PostgresLiveChannelRepository(databaseUrl!);
    const secondRepository = new PostgresLiveChannelRepository(databaseUrl!);
    const input = {
      taskId: created.task.id,
      providerId: "search",
      cumulativeAmountAtomic: 50_000n,
      startedAtUnixSeconds: 1_800_001_100n,
    };
    const results = await Promise.all([
      firstRepository.beginFinalization(input),
      secondRepository.beginFinalization(input),
    ]);

    expect(results.filter((result) => result === "acquired")).toHaveLength(1);
    expect(results.filter((result) => result === "busy")).toHaveLength(1);

    const leased = await app.getTask(created.task.id);
    const searchChannel = leased.channels.find((channel) => channel.providerId === "search");
    expect(searchChannel?.recoveryState?.stage).toBe("finalization-started");
    expect(searchChannel?.recoveryState?.attemptedSettledAtomic).toBe("50000");

    await app.recordChannelState(created.task.id, "search", {
      status: "distributed",
      distributionTransactionSignature: "lease-final-signature",
      recoveryState: { stage: "finalized" },
    });
    await expect(firstRepository.beginFinalization({
      ...input,
      startedAtUnixSeconds: 1_800_001_200n,
    })).resolves.toBe("terminal");

    await firstRepository.close();
    await secondRepository.close();
    await repository.close();
  });

  it("persists the live open, authorize, settle, distribute and refund lifecycle end to end", async () => {
    const repository = new PostgresCanalisRepository(databaseUrl!);
    const liveRepository = new PostgresLiveChannelRepository(databaseUrl!);
    const app = new CanalisApplication(repository, () => 1_800_002_000n);

    const created = await app.createTask({
      owner: "live-lifecycle-owner",
      agentId: "live-lifecycle-agent",
      budgetUsd: "1.00",
      maxPerCallUsd: "0.25",
      allowedProviders: ["search"],
      mode: "x402",
    });
    const reserved = created.channels[0];
    expect(reserved?.status).toBe("reserved");
    expect(reserved?.ceilingAtomic).toBe("1000000");

    const opened = await app.recordChannelState(created.task.id, "search", {
      status: "open",
      channelAddress: "live-product-channel-address",
      openTransactionSignature: "live-product-open-signature",
      recoveryState: {
        stage: "open",
        expiresAtUnixSeconds: "1800005600",
        protocol: "x402:upto",
      },
    });
    expect(opened.channels[0]?.channelAddress).toBe("live-product-channel-address");

    const executed = await app.executeTask(created.task.id);
    const authorized = executed.channels[0];
    expect(executed.task.status).toBe("completed");
    expect(executed.graph.flows).toHaveLength(1);
    expect(executed.graph.flows[0]?.receipt?.protocol).toBe("x402");
    expect(authorized?.cumulativeAuthorizedAtomic).toBe("50000");
    expect(authorized?.spentAtomic).toBe("50000");
    expect(executed.graph.remainingAtomic).toBe("950000");

    const settledAtomic = BigInt(authorized!.cumulativeAuthorizedAtomic);
    const ceilingAtomic = BigInt(authorized!.ceilingAtomic);
    const refundedAtomic = ceilingAtomic - settledAtomic;
    expect(settledAtomic + refundedAtomic).toBe(ceilingAtomic);

    const terminalSignature = "live-product-finalization-signature";
    await app.recordChannelState(created.task.id, "search", {
      status: "distributed",
      settleTransactionSignature: terminalSignature,
      distributionTransactionSignature: terminalSignature,
      refundTransactionSignature: terminalSignature,
      recoveryState: {
        stage: "finalized",
        settledAtomic: settledAtomic.toString(),
        refundedAtomic: refundedAtomic.toString(),
        finalizationTransactionSignature: terminalSignature,
      },
    });
    await liveRepository.recordSettlement({
      taskId: created.task.id,
      providerId: "search",
      cumulativeAmountAtomic: settledAtomic,
      transactionSignature: terminalSignature,
    });

    await liveRepository.close();
    await repository.close();

    const restoredRepository = new PostgresCanalisRepository(databaseUrl!);
    const restoredApp = new CanalisApplication(restoredRepository);
    const restored = await restoredApp.getTask(created.task.id);
    const terminalChannel = restored.channels[0];

    expect(restored.settlement.status).toBe("finalized");
    expect(restored.settlement.transactions).toEqual([
      { providerId: "search", transactionSignature: terminalSignature },
    ]);
    expect(terminalChannel?.status).toBe("distributed");
    expect(terminalChannel?.openTransactionSignature).toBe("live-product-open-signature");
    expect(terminalChannel?.distributionTransactionSignature).toBe(terminalSignature);
    expect(terminalChannel?.refundTransactionSignature).toBe(terminalSignature);
    expect(terminalChannel?.recoveryState?.settledAtomic).toBe("50000");
    expect(terminalChannel?.recoveryState?.refundedAtomic).toBe("950000");
    expect(
      BigInt(String(terminalChannel?.recoveryState?.settledAtomic)) +
        BigInt(String(terminalChannel?.recoveryState?.refundedAtomic)),
    ).toBe(BigInt(terminalChannel!.ceilingAtomic));

    await restoredRepository.close();
  });
});
