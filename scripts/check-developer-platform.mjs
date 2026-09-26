import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function requireText(path, patterns) {
  const source = read(path);
  for (const pattern of patterns) {
    if (!source.includes(pattern)) {
      throw new Error(`${path} is missing required developer-platform contract: ${pattern}`);
    }
  }
}

requireText("packages/application/src/developer.ts", [
  "tasks:read",
  "tasks:write",
  "tasks:execute",
  "channels:read",
  "channels:write",
  "receipts:read",
  "webhooks:read",
  "webhooks:write",
]);

requireText("packages/persistence/migrations/0010_developer_platform.sql", [
  "developer_api_keys",
  "token_hash",
  "webhook_subscriptions",
  "webhook_deliveries",
  "secret_envelope",
  "snapshot - 'token_hash'",
  "snapshot - 'secret_envelope'",
]);

requireText("apps/web/src/server/developer.ts", [
  "createHmac",
  "assertSafeWebhookUrl",
  "setTimeout(() => controller.abort(), 8_000)",
  "WEBHOOK_DELIVERY_FAILED",
  "nextAttemptAt",
]);

requireText("apps/web/src/server/developer-api.ts", [
  'operation: "v1.task.create"',
  'operation: "v1.task.execute"',
  "publishWebhookEvent",
]);

requireText("apps/web/src/app/api/v1/route.ts", ["canalis-api-version", "v1"]);
requireText("packages/sdk/src/index.ts", [
  "/api/v1/tasks",
  "/api/v1/webhooks",
  "verifyCanalisWebhook",
  "timingSafeEqual",
]);
requireText("examples/agent-integration/src/index.ts", [
  "CANALIS_API_KEY",
  "CanalisClient",
  "mode: \"deterministic\"",
  "tasks.execute",
  "tasks.receipts",
]);
requireText("apps/web/src/components/product/app-shell.tsx", [
  'href: "/developers"',
  'label: "Developers"',
]);
requireText("docs/DEVELOPER_API.md", [
  "Developer API v1",
  "Idempotency-Key",
  "Canalis-Signature",
  "@canalis/agent-example",
]);
requireText(".env.example", ["CANALIS_DEVELOPER_SECRET_KEY="]);

const sdk = read("packages/sdk/src/index.ts");
if (/cnl_(?:sbx|live)_[A-Za-z0-9_-]{20,}/.test(sdk)) {
  throw new Error("SDK source must not contain a real-looking Canalis API token.");
}

console.log("Developer platform contracts verified.");
