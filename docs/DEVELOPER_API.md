# Canalis Developer API v1

Canalis exposes a versioned server-to-server API at `https://canalis-sigma.vercel.app/api/v1` and a lightweight TypeScript SDK in `packages/sdk`.

The developer API uses the same persisted policy engine, provider registry, task lifecycle, idempotency layer, and Solana finalization safeguards as the dashboard. API clients do not bypass wallet ownership or runtime constraints.

## 1. Create an API key

Connect a wallet in Canalis and open **Developers**. Create a **Sandbox / devnet** key for integration testing. The token is shown exactly once and looks like:

```text
cnl_sbx_<id>_<secret>
```

Production keys use the `cnl_live_` prefix. Canalis stores only a SHA-256 hash of each token. Rotation invalidates the previous token immediately; revocation is terminal.

Available scopes:

| Scope | Capability |
| --- | --- |
| `tasks:read` | List and inspect owned tasks |
| `tasks:write` | Create tasks |
| `tasks:execute` | Execute provider routes for a task |
| `channels:read` | Inspect payment channels |
| `channels:write` | Finalize or recover live channels |
| `receipts:read` | Read provider receipts and settlements |
| `webhooks:read` | Inspect subscriptions and deliveries |
| `webhooks:write` | Create/update webhooks, rotate secrets, retry deliveries |

Sandbox keys cannot operate a mainnet workspace. They support deterministic execution and the current devnet x402 channel path only.

## 2. Authentication and idempotency

```http
Authorization: Bearer cnl_sbx_...
```

You may also use `X-Canalis-Key`, but Bearer authentication is preferred.

For every mutation, send an explicit `Idempotency-Key` and reuse the same value if the HTTP request must be retried:

```http
Idempotency-Key: create:research-run:2026-09-26-001
```

Canalis persists successful and failed mutation responses against the key. Reusing one key for a different request returns a conflict instead of guessing retry intent.

## 3. REST surface

All responses use API version `v1`. Successful v1 responses include `Canalis-Api-Version: v1`.

### Discover the API

```http
GET /api/v1
```

### Create a task

```http
POST /api/v1/tasks
Content-Type: application/json
Authorization: Bearer <key>
Idempotency-Key: task:create:001

{
  "name": "research-run",
  "mode": "deterministic",
  "budgetUsd": "1.00",
  "maxPerCallUsd": "0.25",
  "allowedProviders": ["search", "data", "inference"]
}
```

Task creation enforces account settings, reusable/inline policy constraints, provider health/ownership/runtime readiness, and the current mainnet safety block.

### List and inspect tasks

```http
GET /api/v1/tasks?page=1&pageSize=20
GET /api/v1/tasks/{taskId}
```

### Execute provider work

```http
POST /api/v1/tasks/{taskId}/execute
Authorization: Bearer <key>
Idempotency-Key: task:execute:{taskId}:001
Content-Type: application/json

{}
```

Execution advances the same cumulative authorization/payment graph used by the dashboard.

### Channels and receipts

```http
GET /api/v1/tasks/{taskId}/channels
GET /api/v1/tasks/{taskId}/receipts
```

The receipts response includes fulfilled provider receipts plus persisted settlement evidence. Canalis never fabricates Solana signatures.

### Finalize or recover a channel

```http
POST /api/v1/tasks/{taskId}/channels/{providerId}/action
Authorization: Bearer <key>
Idempotency-Key: channel:{taskId}:{providerId}:terminal
Content-Type: application/json

{ "action": "finalize" }
```

Use `recover` only when the channel state permits recovery. The endpoint preserves Canalis's terminal lease and ambiguous-finalization protection: if a previous transaction may have reached Solana, automatic rebroadcast is blocked until reconciliation.

## 4. TypeScript SDK

Inside this repository:

```ts
import { CanalisClient } from "@canalis/sdk";

const canalis = new CanalisClient({
  apiKey: process.env.CANALIS_API_KEY!,
});

const created = await canalis.tasks.create({
  name: "research-run",
  mode: "deterministic",
  budgetUsd: "1.00",
  maxPerCallUsd: "0.25",
});

const taskId = (created.task as { id: string }).id;
await canalis.tasks.execute(taskId, {
  idempotencyKey: `execute:${taskId}:1`,
});

const receipts = await canalis.tasks.receipts(taskId);
console.log(receipts);
```

The SDK defaults to the canonical production URL and accepts `baseUrl` for local/sandbox testing.

## 5. Webhooks

Create subscriptions from **Developers** or with an API key carrying `webhooks:write`:

```http
POST /api/v1/webhooks
Authorization: Bearer <key>
Idempotency-Key: webhook:create:001
Content-Type: application/json

{
  "url": "https://agent.example.com/webhooks/canalis",
  "description": "Agent lifecycle",
  "events": ["task.created", "payment.authorized", "settlement.completed", "settlement.failed"]
}
```

The signing secret is returned once. It is encrypted at rest using `CANALIS_DEVELOPER_SECRET_KEY`.

Supported event types:

- `task.created`
- `task.executed`
- `task.completed`
- `task.cancelled`
- `channel.updated`
- `channel.finalized`
- `channel.recovered`
- `payment.authorized`
- `payment.rejected`
- `settlement.completed`
- `settlement.failed`

Every payload has a stable event ID:

```json
{
  "id": "evt_...",
  "type": "task.created",
  "apiVersion": "v1",
  "createdAtUnixSeconds": "...",
  "data": {}
}
```

Delivery headers:

```text
Canalis-Api-Version: v1
Canalis-Event-Id: evt_...
Canalis-Event-Type: task.created
Canalis-Delivery-Id: whd_...
Canalis-Timestamp: 1790...
Canalis-Signature: v1=<hex hmac>
```

The signature is:

```text
HMAC_SHA256(webhook_secret, `${Canalis-Timestamp}.${raw_request_body}`)
```

Verify against the **raw** body before parsing JSON and reject stale timestamps. `verifyCanalisWebhook()` in `@canalis/sdk` uses constant-time comparison and a five-minute replay tolerance by default.

Webhook URLs are required to use HTTPS outside local development, may not embed credentials, and are DNS-checked to block private/reserved network destinations.

### Retries and observability

Each delivery attempt is persisted with event ID, subscription ID, attempt number, HTTP result/error, and next retry timestamp. Failed deliveries remain observable and retry-safe. They can be retried manually from the Developers workspace or through:

```http
POST /api/v1/webhooks/deliveries/{deliveryId}/retry
```

Retries create a new delivery attempt for the same stable event ID; a succeeded attempt is idempotently left alone. `nextAttemptAt` is retained for queue/scheduler integration, but this release does not claim an always-on background worker where the deployment has not configured one.

## 6. Clean sandbox example

From the repository root:

```bash
pnpm install --no-frozen-lockfile
export CANALIS_API_KEY='cnl_sbx_...'
export CANALIS_BASE_URL='https://canalis-sigma.vercel.app'
pnpm --filter @canalis/agent-example start
```

The example creates a deterministic sandbox task, executes it, and reads channels, receipts, and settlement evidence. It requires no private key or wallet seed in the agent process.

## 7. Production configuration

The web deployment needs:

```text
DATABASE_URL=...
CANALIS_DEVELOPER_SECRET_KEY=<base64 32-byte key>
```

`CANALIS_DEVELOPER_SECRET_KEY` encrypts webhook signing secrets. API keys are hash-only and do not require reversible encryption. Generate encryption keys outside the repository and never log or commit them.
