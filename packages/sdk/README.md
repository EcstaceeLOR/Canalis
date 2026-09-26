# @canalis/sdk

Lightweight TypeScript client for the versioned Canalis Developer API.

```ts
import { CanalisClient } from "@canalis/sdk";

const canalis = new CanalisClient({
  apiKey: process.env.CANALIS_API_KEY!,
});

const created = await canalis.tasks.create({
  name: "research-agent-run",
  mode: "deterministic",
  budgetUsd: "1.00",
  maxPerCallUsd: "0.25",
});

const taskId = (created.task as { id: string }).id;
await canalis.tasks.execute(taskId, { idempotencyKey: `execute:${taskId}:1` });
const receipts = await canalis.tasks.receipts(taskId);
console.log(receipts);
```

Use sandbox keys (`cnl_sbx_...`) for development. Sandbox credentials cannot operate a mainnet workspace. Mutation retries should reuse the same explicit `idempotencyKey`.

## Webhook verification

```ts
import { verifyCanalisWebhook } from "@canalis/sdk";

const valid = verifyCanalisWebhook({
  rawBody,
  secret: process.env.CANALIS_WEBHOOK_SECRET!,
  signature: request.headers.get("canalis-signature")!,
  timestamp: request.headers.get("canalis-timestamp")!,
});
```

The default replay window is five minutes. Verify the signature against the exact raw request body before parsing JSON.
