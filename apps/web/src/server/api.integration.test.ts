import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDatabase } from "@canalis/persistence";
import { POST as createTask } from "../app/api/tasks/route";
import { GET as getTask } from "../app/api/tasks/[id]/route";
import { POST as executeTask } from "../app/api/tasks/[id]/execute/route";
import { resetCanalisApplicationForTests } from "./canalis";

const databaseUrl = process.env.DATABASE_URL;
const dbDescribe = databaseUrl ? describe : describe.skip;

dbDescribe("Canalis HTTP API integration", () => {
  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
  });

  afterAll(async () => {
    await resetCanalisApplicationForTests();
  });

  it("creates, executes and reloads a persisted task through route handlers", async () => {
    const createResponse = await createTask(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: "api-integration-owner",
          budgetUsd: "1.00",
          maxPerCallUsd: "0.25",
          allowedProviders: ["search", "data", "inference"],
        }),
      }),
    );
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      task: { id: string; status: string };
    };
    expect(created.task.status).toBe("active");

    const executeResponse = await executeTask(
      new Request(`http://localhost/api/tasks/${created.task.id}/execute`, {
        method: "POST",
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
      new Request(`http://localhost/api/tasks/${created.task.id}`),
      { params: Promise.resolve({ id: created.task.id }) },
    );
    expect(getResponse.status).toBe(200);
    const restored = (await getResponse.json()) as {
      task: { status: string };
      graph: { remainingAtomic: string; flows: unknown[] };
      channels: unknown[];
    };
    expect(restored.task.status).toBe("completed");
    expect(restored.graph.remainingAtomic).toBe("800000");
    expect(restored.graph.flows).toHaveLength(3);
    expect(restored.channels).toHaveLength(3);
  });

  it("returns a stable validation error envelope", async () => {
    const response = await createTask(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
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
});
