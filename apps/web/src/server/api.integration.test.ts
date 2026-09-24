import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  migrateDatabase,
  PostgresWalletAuthRepository,
} from "@canalis/persistence";
import { POST as createTask } from "../app/api/tasks/route";
import { GET as getTask } from "../app/api/tasks/[id]/route";
import { POST as executeTask } from "../app/api/tasks/[id]/execute/route";
import { resetWalletAuthForTests } from "./auth";
import { resetCanalisApplicationForTests } from "./canalis";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;
const WALLET_A = "11111111111111111111111111111111";
const WALLET_B = "SysvarC1ock11111111111111111111111111111111";
const TOKEN_A = "api-session-token-a";
const TOKEN_B = "api-session-token-b";

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function headers(token: string, json = false) {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    cookie: `canalis_session=${token}`,
  };
}

dbDescribe("Canalis HTTP API integration", () => {
  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    const authRepository = new PostgresWalletAuthRepository(databaseUrl!);
    const expires = 9_999_999_999n;
    await authRepository.createSession({
      tokenHash: hash(TOKEN_A),
      walletAddress: WALLET_A,
      network: "solana:devnet",
      createdAtUnixSeconds: 1n,
      expiresAtUnixSeconds: expires,
      lastSeenAtUnixSeconds: 1n,
    });
    await authRepository.createSession({
      tokenHash: hash(TOKEN_B),
      walletAddress: WALLET_B,
      network: "solana:devnet",
      createdAtUnixSeconds: 1n,
      expiresAtUnixSeconds: expires,
      lastSeenAtUnixSeconds: 1n,
    });
    await authRepository.close();
  });

  afterAll(async () => {
    await resetWalletAuthForTests();
    await resetCanalisApplicationForTests();
  });

  it("creates, executes and reloads a wallet-owned persisted task", async () => {
    const createResponse = await createTask(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: headers(TOKEN_A, true),
        body: JSON.stringify({
          owner: "spoofed-owner",
          budgetUsd: "1.00",
          maxPerCallUsd: "0.25",
          allowedProviders: ["search", "data", "inference"],
        }),
      }),
    );
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      task: { id: string; status: string; owner: string };
    };
    expect(created.task.status).toBe("active");
    expect(created.task.owner).toBe(WALLET_A);

    const executeResponse = await executeTask(
      new Request(`http://localhost/api/tasks/${created.task.id}/execute`, {
        method: "POST",
        headers: headers(TOKEN_A),
      }),
      { params: Promise.resolve({ id: created.task.id }) },
    );
    expect(executeResponse.status).toBe(200);
    const executed = (await executeResponse.json()) as {
      graph: { spentAtomic: string; flows: unknown[] };
    };
    expect(executed.graph.spentAtomic).toBe("200000");
    expect(executed.graph.flows).toHaveLength(3);

    await resetCanalisApplicationForTests();

    const getResponse = await getTask(
      new Request(`http://localhost/api/tasks/${created.task.id}`, {
        headers: headers(TOKEN_A),
      }),
      { params: Promise.resolve({ id: created.task.id }) },
    );
    expect(getResponse.status).toBe(200);
    const restored = (await getResponse.json()) as {
      task: { status: string; owner: string };
      graph: { remainingAtomic: string; flows: unknown[] };
      channels: unknown[];
    };
    expect(restored.task.status).toBe("completed");
    expect(restored.task.owner).toBe(WALLET_A);
    expect(restored.graph.remainingAtomic).toBe("800000");
    expect(restored.graph.flows).toHaveLength(3);
    expect(restored.channels).toHaveLength(3);

    const forbiddenRead = await getTask(
      new Request(`http://localhost/api/tasks/${created.task.id}`, {
        headers: headers(TOKEN_B),
      }),
      { params: Promise.resolve({ id: created.task.id }) },
    );
    expect(forbiddenRead.status).toBe(403);
    expect((await forbiddenRead.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("returns a stable validation error envelope for an authenticated wallet", async () => {
    const response = await createTask(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: headers(TOKEN_A, true),
        body: JSON.stringify({ budgetUsd: "not-money" }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Task request validation failed.");
  });

  it("requires an authenticated wallet", async () => {
    const response = await createTask(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ budgetUsd: "1.00" }),
      }),
    );
    expect(response.status).toBe(401);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
  });
});
