# Canalis

**The payment orchestration layer for autonomous agents on Solana.**

> Give an agent a budget. Canalis handles everything it pays for.

### 🌐 [Live Demo](https://canalis-git-deploy-web-standalone-demola-codes.vercel.app)

Canalis turns one approved task budget into policy-controlled payments across multiple machine services. It uses **Solana payment-channel semantics** to keep high-frequency authorizations offchain, records every paid action in a task-level payment graph, settles actual cumulative usage, and makes unused budget recoverable by the payer.

## The 20-second demo

Create a `$1.00 USDC` agent task with a `$0.25` per-call cap and approve three providers:

```text
$1.00 approved task budget
        |
        +--> Search       $0.05
        +--> Data         $0.03
        +--> Inference    $0.12
        |
        +--> $0.20 actually authorized
        +--> $0.80 recoverable
```

Every paid call is checked against task policy **before paid work is returned**. Each provider route advances cumulative authorization independently, while Canalis maintains one global task budget and one verifiable receipt graph.

## Why Solana payment channels matter

An autonomous workflow can make many small paid calls. Sending an onchain transaction for every call creates unnecessary settlement overhead, while simply giving an agent a funded wallet removes financial control.

Canalis uses the payment-channel model instead:

```text
open capped channel
      ↓
signed cumulative vouchers offchain
      ↓
settle + seal actual usage
      ↓
distribute provider payout
      ↓
return unused escrow to payer
```

For Canalis v1, each provider has its own channel ceiling, but the user sees a single task budget. The core accounting invariant is:

```text
provider payout + payer refund = provider channel ceiling
```

Once all routes are terminal:

```text
provider payouts + recovered funds = original task budget
```

Canalis does **not** deploy a replacement payment-channel contract. The innovation is the orchestration layer above the primitive: task policy, multi-provider routing, protocol adapters, cumulative accounting, receipts, finalization, and recovery.

## What is implemented

- **Task budgets and policy engine** — total ceiling, provider allowlist, per-call cap, provider cap, expiry, and stable rejection codes.
- **Multi-provider route orchestration** — one logical task across Search, Data, Inference, or protocol-backed providers.
- **Canonical voucher primitives** — exact 50-byte Solana payment-channel voucher encoding, Ed25519 signing, monotonicity, expiry, and ceiling checks.
- **x402 integration** — `upto` / `exact` HTTP payment challenges mapped into Canalis policy and receipts.
- **MPP integration** — charge and metered-session semantics behind the same provider interface.
- **Payment graph** — price, cumulative authorization, payment reference, output hash, protocol metadata, rejection/failure state.
- **Settlement/finalization coordinator** — settle/seal, distribution, payer recovery, explorer links, reconciliation, and retry-safe partial-failure paths.
- **Judge-safe dashboard** — deterministic providers keep the demo reliable while using the real Canalis core.

The deterministic UI deliberately **does not fabricate blockchain signatures**. Live transaction links are displayed only when genuine settlement evidence exists.

## Quickstart

Requirements: **Node.js 22+** and **pnpm 10.17.1**.

```bash
git clone https://github.com/EcstaceeLOR/Canalis.git
cd Canalis
cp .env.example .env
pnpm install --no-frozen-lockfile
pnpm judge:check
pnpm dev
```

Open `http://localhost:3000`.

`pnpm judge:check` performs the complete submission gate: workspace build, unit/integration/adversarial tests, TypeScript validation, and committed-secret scanning.

## Judge path

The reproducible under-three-minute Colosseum walkthrough is in [`docs/JUDGE_DEMO.md`](docs/JUDGE_DEMO.md).

Default judge configuration:

| Setting | Value |
| --- | ---: |
| Budget | `1.00 USDC` |
| Max / call | `0.25 USDC` |
| Search | `0.05 USDC` |
| Data | `0.03 USDC` |
| Inference | `0.12 USDC` |
| Authorized spend | `0.20 USDC` |
| Recoverable | `0.80 USDC` |

## Architecture

```text
Agent owner
    |
    v
+--------------------+       +--------------------+
| Task + budget      |------>| Policy engine      |
| one global ceiling |       | caps / allowlists  |
+---------+----------+       +--------------------+
          |
          v
+--------------------+       +--------------------+
| Route orchestrator |------>| Provider adapters  |
| payment graph      |       | demo / x402 / MPP  |
+---------+----------+       +--------------------+
          |
          v
+--------------------------------------------------+
| Solana payment-channel boundary                  |
| voucher -> settle/seal -> distribute -> recovery |
+--------------------------------------------------+
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/AGENTIC_PAYMENTS.md`](docs/AGENTIC_PAYMENTS.md), and [`docs/settlement-finalization.md`](docs/settlement-finalization.md) for the implementation contracts.

## Repository map

```text
apps/web/          Next.js control-plane dashboard
packages/core/     task policy + route orchestration
packages/providers demo + x402 + MPP provider adapters
packages/solana/   vouchers + signatures + finalization boundary
examples/          protocol/channel spikes
docs/              architecture and judge proof
```

The repository intentionally contains **one CI workflow** and no Kubernetes, Terraform, Helm, or unrelated platform scaffolding. The submission keeps the engineering signal on the product primitive.

## Security and accounting guarantees

Automated tests cover:

- non-positive payment rejection,
- provider allowlists and per-call caps,
- provider and total-budget exhaustion,
- non-monotonic/replayed cumulative amounts,
- quote/voucher delta mismatch,
- channel-ceiling overflow,
- wrong-mint rejection before fulfillment,
- downstream failure after authorization without unsafe accounting rollback,
- exact u64/i64 voucher boundaries,
- settlement payout/refund reconciliation,
- distribution and settlement retry paths,
- committed private-key/seed material scanning.

Signers are injected at the wallet/runtime boundary. Canalis does not load or commit wallet private keys.

## Deployment

The dashboard is live on Vercel: **[canalis-git-deploy-web-standalone-demola-codes.vercel.app](https://canalis-git-deploy-web-standalone-demola-codes.vercel.app)**.

Vercel uses **Root Directory = `apps/web`**. The web app is deployment-self-contained so hosting does not depend on installing the rest of the monorepo, while the canonical Canalis core, provider, and Solana packages remain in the repository for development, testing, and the live payment-channel proof.

Copy environment names from [`.env.example`](.env.example). Deterministic mode requires no secret. Live x402/MPP/Solana signers must be injected outside the repository.

## Scope discipline

Canalis v1 deliberately does not include:

- a new payment-channel smart contract,
- a general-purpose wallet,
- a generic x402 marketplace,
- custom blockchain infrastructure,
- production-scale enterprise administration,
- unnecessary deployment/platform machinery.

The goal is simple: make **bounded autonomous spending across many services** obvious, usable, verifiable, and Solana-native.

## Status

Built for **Colosseum Crypto World's Fair 2026 — Solana track**.

## License

MIT
