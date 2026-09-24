import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  migrateDatabase,
  PostgresWalletAuthRepository,
} from "@canalis/persistence";
import { GET as listTasks, POST as createTask } from "../app/api/tasks/route";
import { GET as getTask } from "../app/api/tasks/[id]/route";
import { POST as executeTask } from "../app/api/tasks/[id]/execute/route";
import { POST as lifecycleTask } from "../app/api/tasks/[id]/lifecycle/route";
import { resetWalletAuthForTests } from "./auth";
import { resetCanalisApplicationForTests } from "./canalis";
import { resetTaskWorkspaceForTests } from "./tasks";

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

async function lifecycle(id: string, action: string, token = TOKEN_A) {
  return lifecycleTask(
    new Request(`http://localhost/api/tasks/${id}/lifecycle`, {
      method: "POST",
      headers: headers(token, true),
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ id }) },
  );
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
    await resetTaskWorkspaceForTests();
    await resetWalletAuthForTests();
    await resetCanalisApplicationForTests();
  });

  it("creates, executes and reloads a wallet-owned persisted task", async () => {
    const createResponse = await createTask(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: headers(TOKEN_A, true),
        body: JSON.stringify({
          name: "API integration execution task",
          description: "Proves canonical execution remains wallet scoped.",
          budgetUsd: "1.00",
          maxPerCallUsd: "0.25",
          expiryMinutes: 60,
          allowedProviders: ["search", "data", "inference"],
          policyId: "inline-bounded",
          saveAsDraft: false,
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
      workspace: { name: string };
    };
    expect(restored.task.status).toBe("completed");
    expect(restored.task.owner).toBe(WALLET_A);
    expect(restored.workspace.name).toBe("API integration execution task");
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
  });

  it("persists drafts, filters owned tasks, and enforces lifecycle transitions", async () => {
    const createResponse = await createTask(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: headers(TOKEN_A, true),
        body: JSON.stringify({
          name: "Workspace lifecycle alpha",
          description: "Searchable persistent draft",
          budgetUsd: "2.00",
          maxPerCallUsd: "0.20",
          expiryMinutes: 360,
          allowedProviders: ["search", "data"],
          policyId: "inline-bounded",
          saveAsDraft: true,
        }),
      }),
    );
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { task: { id: string; status: string } };
    expect(created.task.status).toBe("draft");

    const listResponse = await listTasks(new Request(
      "http://localhost/api/tasks?q=Workspace%20lifecycle&status=draft&provider=search&sort=name_asc&page=1&pageSize=10",
      { headers: headers(TOKEN_A) },
    ));
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as { tasks: Array<{ id: string; name: string; status: string }>; total: number };
    expect(listed.tasks.some((task) => task.id === created.task.id && task.name === "Workspace lifecycle alpha" && task.status === "draft")).toBe(true);
    expect(listed.total).toBeGreaterThanOrEqual(1);

    const otherWalletList = await listTasks(new Request(
      "http://localhost/api/tasks?q=Workspace%20lifecycle",
      { headers: headers(TOKEN_B) },
    ));
    expect(otherWalletList.status).toBe(200);
    expect(((await otherWalletList.json()) as { total: number }).total).toBe(0);

    const submit = await lifecycle(created.task.id, "submit");
    expect(submit.status).toBe(200);
    expect(((await submit.json()) as { task: { status: string } }).task.status).toBe("active");

    const cancel = await lifecycle(created.task.id, "cancel");
    expect(cancel.status).toBe(200);
    expect(((await cancel.json()) as { task: { status: string } }).task.status).toBe("cancelled");

    const archive = await lifecycle(created.task.id, "archive");
    expect(archive.status).toBe(200);
    expect(((await archive.json()) as { task: { status: string } }).task.status).toBe("archived");

    const invalidArchive = await lifecycle(created.task.id, "archive");
    expect(invalidArchive.status).toBe(409);
    expect((await invalidArchive.json()) as { error: { code: string } }).toMatchObject({ error: { code: "INVALID_TASK_TRANSITION" } });

    const forbiddenLifecycle = await lifecycle(created.task.id, "duplicate", TOKEN_B);
    expect(forbiddenLifecycle.status).toBe(403);

    const duplicate = await lifecycle(created.task.id, "duplicate");
    expect(duplicate.status).toBe(201);
    const copied = (await duplicate.json()) as { task: { id: string; status: string }; workspace: { name: string } };
    expect(copied.task.id).not.toBe(created.task.id);
    expect(copied.task.status).toBe("draft");
    expect(copied.workspace.name).toContain("copy");
  });

  it("returns a stable validation error envelope for an authenticated wallet", async () => {
    const response = await createTask(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: headers(TOKEN_A, true),
        body: JSON.stringify({ name: "Bad money", budgetUsd: "not-money" }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Task workspace request validation failed.");
  });

  it("requires an authenticated wallet", async () => {
    const response = await createTask(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Unauthenticated task", budgetUsd: "1.00" }),
      }),
    );
    expect(response.status).toBe(401);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
  });
});
