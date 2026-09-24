# Canalis MVP Architecture

This document is intentionally narrow. It defines the architecture we will keep stable through the Crypto World's Fair build unless a core Solana primitive forces a change.

## 1. Product invariant

Canalis is **not** a payment-channel implementation. It is an orchestration layer that turns a user-approved task budget into controlled payments across an autonomous workflow.

The core user promise is:

> A user gives an agent a bounded budget. The agent may buy approved services while Canalis enforces limits, records the route, settles actual usage, and returns unused funds.

## 2. Core domain objects

### Task
A unit of work requested by a user.

- `id`
- `owner`
- `agentId`
- `budget`
- `mint`
- `status`
- `createdAt`
- `expiresAt`

### Policy
Rules that constrain task spending.

- total budget cap
- optional per-call cap
- provider allowlist
- optional provider-specific caps
- task expiry

### Provider
A paid external service the agent may call.

- provider id
- endpoint
- payee wallet
- supported payment protocol (`mpp`, `x402`, or demo adapter)
- price model

### Channel
Local representation of a Solana payment channel used by a task/provider route.

- channel PDA
- payer
- payee
- mint
- deposit ceiling
- authorized signer
- cumulative authorized amount
- lifecycle state

### Flow
One paid step inside a task.

- task id
- provider id
- requested resource
- quoted amount
- authorized cumulative amount
- voucher/receipt metadata
- service result status
- timestamp

### Settlement
The terminal record linking offchain usage to onchain settlement.

- channel id
- final cumulative amount
- settlement transaction signature
- provider distribution
- payer refund

## 3. System boundaries

```text
+-----------------------+
| Web Dashboard         |
| task + budget + graph |
+-----------+-----------+
            |
            v
+-----------------------+
| Canalis API           |
| task/session state    |
+-----+------------+----+
      |            |
      v            v
+-----------+  +----------------+
| Policy    |  | Route          |
| Engine    |  | Orchestrator   |
+-----------+  +-------+--------+
                     |
            +--------+---------+
            |                  |
            v                  v
+-------------------+   +-------------------+
| Provider Adapter  |   | Channel Adapter   |
| MPP/x402/demo     |   | Solana channels   |
+-------------------+   +---------+---------+
                                  |
                                  v
                       +----------------------+
                       | Solana Payment       |
                       | Channels Program     |
                       +----------------------+
```

## 4. Repository shape

We will keep the repo small and legible:

```text
apps/
  web/          # Next.js dashboard and demo
  api/          # lightweight API/orchestration service
packages/
  core/         # task, policy, route, receipts, shared types
  solana/       # payment-channel adapter and voucher helpers
  providers/    # MPP/x402/demo provider adapters
examples/
  agent-demo/   # deterministic three-provider judge demo
docs/
  ARCHITECTURE.md
```

No Kubernetes, Terraform, Helm, or large CI matrix for the hackathon MVP.

## 5. Payment-channel integration

Canalis will integrate the official Solana payment-channel program rather than deploy a competing channel contract.

The payment lifecycle we depend on is:

1. **Open** — escrow a maximum spending ceiling for payer → payee.
2. **Authorize offchain** — issue Ed25519-signed cumulative vouchers.
3. **Settle** — advance the settled cumulative amount from a verified voucher.
4. **Seal** — stop additional spending when the task/channel is finished.
5. **Distribute** — pay the authorized provider amount.
6. **Refund** — return the unspent remainder to the payer.

Canalis owns orchestration state; the Solana program owns settlement truth.

## 6. Multi-provider model

The official channel primitive is payer/payee scoped. Therefore the MVP will use **one payment channel per provider used by a task**, while Canalis presents them to the user as one logical task budget.

Example:

```text
Task budget: $1.00

Canalis logical session
  ├── Search provider channel     ceiling $0.20
  ├── Inference provider channel  ceiling $0.60
  └── Data provider channel       ceiling $0.20
```

The route orchestrator must guarantee that the aggregate ceilings never exceed the task budget and that actual authorized spend never exceeds policy limits.

This preserves the core product promise without inventing unsupported cross-payee semantics.

## 7. Policy enforcement

Policies are evaluated **before** Canalis signs/advances a voucher.

Required v1 checks:

1. task is active and not expired,
2. provider is allowed,
3. requested amount is non-negative and within the per-call cap,
4. provider cumulative spend remains within its channel ceiling,
5. aggregate task spend remains within total budget,
6. voucher cumulative amount is monotonic.

A denied request creates a visible rejected flow but no new voucher.

## 8. Receipt model

Every successful paid call produces a Canalis receipt containing enough information to connect:

```text
task
 -> provider request
 -> quoted price
 -> cumulative voucher authorization
 -> service response hash / identifier
 -> eventual settlement transaction
```

The dashboard uses these receipts to render the payment graph.

## 9. Demo architecture

The judge demo must be deterministic. We will ship three small paid provider adapters:

- **Search** — returns a deterministic search result payload.
- **Inference** — returns a deterministic/sandboxed model-style response.
- **Data** — returns a structured lookup payload.

The same provider interface can later point to real MPP/x402 services.

Demo story:

```text
User authorizes $1.00
      ↓
Agent receives task
      ↓
Search ($0.05)
      ↓
Data ($0.03)
      ↓
Inference ($0.12)
      ↓
Task finished at $0.20 actual spend
      ↓
Channels settle
      ↓
$0.80 aggregate unused ceiling is recovered
```

## 10. MVP success criteria

Canalis v1 is complete when a judge can:

- connect a Solana wallet,
- create a task with a capped budget,
- start an agent workflow,
- watch at least three paid flows appear live,
- inspect why each payment was allowed,
- see cumulative authorized spend never exceed policy,
- settle the associated channels on Solana,
- inspect transaction signatures,
- see unused funds recovered,
- understand the entire value proposition in under three minutes.

## 11. Engineering rules

- Prefer a working vertical slice over infrastructure breadth.
- Do not add a service unless the demo/product requires it.
- Keep blockchain-specific code isolated in `packages/solana`.
- Keep protocol adapters isolated in `packages/providers`.
- Unit-test policy invariants and voucher accounting heavily.
- Every UI feature must map to something a judge can understand or interact with.
