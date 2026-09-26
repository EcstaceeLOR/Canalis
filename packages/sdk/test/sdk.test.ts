import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CanalisApiError, CanalisClient, verifyCanalisWebhook } from "../src/index.js";

describe("Canalis SDK", () => {
  it("sends bearer auth and explicit idempotency keys for mutations", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new CanalisClient({
      apiKey: "cnl_sbx_aaaaaaaaaaaa_testtokenvalue000000000000",
      baseUrl: "https://canalis.example",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return new Response(JSON.stringify({ task: { id: "task_1" } }), { status: 201, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });

    await client.tasks.create({ name: "Agent task" }, { idempotencyKey: "sdk-test-key-0001" });
    const call = calls[0]!;
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer cnl_sbx_aaaaaaaaaaaa_testtokenvalue000000000000");
    expect(headers.get("idempotency-key")).toBe("sdk-test-key-0001");
    expect(call.url).toBe("https://canalis.example/api/v1/tasks");
  });

  it("surfaces stable API errors", async () => {
    const client = new CanalisClient({
      apiKey: "cnl_sbx_aaaaaaaaaaaa_testtokenvalue000000000000",
      fetch: (async () => new Response(JSON.stringify({ code: "API_KEY_SCOPE_REQUIRED", message: "scope missing", details: { requiredScope: "tasks:write" } }), { status: 403 })) as typeof fetch,
    });
    await expect(client.tasks.create({ name: "blocked" })).rejects.toMatchObject<Partial<CanalisApiError>>({
      status: 403,
      code: "API_KEY_SCOPE_REQUIRED",
      message: "scope missing",
    });
  });

  it("verifies signed webhook payloads with replay tolerance", () => {
    const rawBody = JSON.stringify({ id: "evt_1", type: "task.created" });
    const secret = "whsec_test_secret";
    const timestamp = "1700000000";
    const signature = `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
    expect(verifyCanalisWebhook({ rawBody, secret, timestamp, signature, nowUnixSeconds: 1700000100 })).toBe(true);
    expect(verifyCanalisWebhook({ rawBody: `${rawBody}x`, secret, timestamp, signature, nowUnixSeconds: 1700000100 })).toBe(false);
    expect(verifyCanalisWebhook({ rawBody, secret, timestamp, signature, nowUnixSeconds: 1700001000 })).toBe(false);
  });
});
