# Canalis

**Governed payment orchestration for autonomous agents on Solana.**

> Give an agent a budget. Keep everything it pays for bounded, attributable, and recoverable.

### 🌐 [Launch Canalis](https://canalis-sigma.vercel.app)

Canalis turns one approved task budget into policy-controlled payments across machine-service providers. It keeps high-frequency authorization offchain where appropriate, records each paid action in a wallet-scoped task graph, settles actual cumulative usage through the Solana payment-channel boundary, and preserves unused capacity for payer recovery.

## Product model

```text
wallet owner
   │
   ├─ approves task budget + spending policy
   │
   ▼
Canalis route orchestrator
   │
   ├─ provider allowlist / caps / network / asset / protocol checks
   ├─ cumulative authorization + receipt evidence
   └─ provider execution boundary
   │
   ▼
Solana payment channel
   │
   ├─ settle actual authorized usage
   └─ recover unused escrow to payer
```

The agent never gets permission to silently increase its mandate. Canalis enforces total ceilings, per-call caps, provider constraints, task expiry, and wallet ownership before paid work is accepted.

## Production surfaces

- **Public landing + onboarding** — visitors see the product model before the control plane; new wallets get a provider → policy → task setup path backed by persisted state.
- **Tasks** — wallet-scoped tasks with drafts, execution, duplication, reruns, status, immutable policy snapshots, and task-level evidence.
- **Provider Registry** — deterministic, x402, and MPP provider configuration with endpoint, payee, assets/networks, pricing, credentials, health, and runtime readiness.
- **Policies** — reusable, versioned spending policies with per-task overrides.
- **Channels** — channel status, cumulative authorization, finalization, distribution, payer recovery, Explorer evidence, and retry-safe partial-failure handling.
- **Transactions** — unified offchain/onchain audit records with filters and export.
- **Dashboard + Analytics** — wallet-scoped operational metrics, settlement health, provider incidents, and drill-downs.
- **Activity + Recovery** — durable user-visible incidents with safe guided actions for provider, settlement, channel, and recovery failures.
- **Settings** — environment, Solana network, default asset, task defaults, notifications, and integrations.

## Runtime truth

Canalis does not fabricate blockchain evidence or pretend a configured integration is executable when the required signing runtime is absent.

**Available in the current product:**

- persistent wallet-scoped control plane,
- deterministic provider execution,
- built-in provider roles used by the supported live x402/devnet channel path,
- real Solana devnet payment-channel proof,
- policy, receipts, transactions, analytics, activity, settlement and recovery workflows.

**Configuration-ready but execution-gated:** external x402 and MPP endpoints can be registered, credentialed, and protocol-health-checked. Autonomous execution remains blocked until the deployment has the required non-custodial signer/session runtime.

**Mainnet:** account settings support a mainnet profile, but task creation is intentionally blocked while the current payment-channel signer/runtime remains devnet-only.

## Solana proof

The committed devnet proof demonstrates the canonical lifecycle without a replacement smart contract:

```text
100,000 unit channel ceiling
        ↓
30,000 cumulative provider settlement
        ↓
70,000 unused units returned to payer
```

See [`docs/JUDGE_DEMO.md`](docs/JUDGE_DEMO.md) for the reproducible walkthrough and [`docs/settlement-finalization.md`](docs/settlement-finalization.md) for the finalization/recovery contract.

Canalis never invents transaction signatures. Explorer links are emitted only when genuine transaction evidence is persisted.

## Architecture

```text
apps/web/            Next.js public product + operator control plane
packages/application schemas, services, settings, operations contracts
packages/core/       task policy + route orchestration
packages/providers/  deterministic + x402 + MPP adapters
packages/persistence Postgres repositories and migrations
packages/solana/     vouchers, signatures, live x402 channel/finalization boundary
examples/            focused protocol/channel proofs
docs/                architecture, product proof, settlement documentation
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/AGENTIC_PAYMENTS.md`](docs/AGENTIC_PAYMENTS.md) for the deeper design.

## Quickstart

Requirements: **Node.js 22+**, **pnpm 10.17.1**, and Postgres for durable product flows.

```bash
git clone https://github.com/EcstaceeLOR/Canalis.git
cd Canalis
cp .env.example .env
pnpm install --no-frozen-lockfile
pnpm db:migrate
pnpm judge:check
pnpm dev
```

Open `http://localhost:3000`.

`pnpm judge:check` runs the production build/tests, TypeScript validation, responsive/accessibility contracts, public-product/onboarding metadata contracts, and committed-secret scanning.

## Production URL and release metadata

The canonical product URL is **https://canalis-sigma.vercel.app**. Public metadata, sitemap, health responses, repository homepage, and this README all use that one stable project-level production alias rather than preview/branch deployment URLs.

`GET /api/health` returns the current web release metadata, Vercel commit/environment information when available, and whether durable storage is configured. It does not expose connection strings, credentials, signing material, or provider secrets.

Optional deployment configuration:

```text
CANALIS_SITE_URL=https://canalis-sigma.vercel.app
CANALIS_RELEASE_VERSION=<human-readable release label>
```

Vercel uses **Root Directory = `apps/web`**. Durable production operation requires `DATABASE_URL`; saved provider credentials additionally require `CANALIS_PROVIDER_SECRET_KEY`. Private keys and signer/session material stay outside the repository.

## Security and reliability

Production hardening includes:

- wallet ownership checks for user-scoped resources,
- centralized schema validation,
- idempotency for critical mutation paths,
- append-only audit events,
- rate limiting and secure response headers,
- provider credential encryption with AES-256-GCM,
- safe retry/finalization coordination,
- no raw secret/stack-trace exposure to the browser,
- committed-secret scanning,
- adversarial tests around replay, duplicate settlement/recovery, stale state, and concurrent actions.

## Scope discipline

Canalis is the orchestration layer above payment primitives. It deliberately does not include a replacement payment-channel contract, a generic wallet, unrelated infrastructure scaffolding, or fake chain evidence.

Built for **Colosseum Crypto World's Fair 2026 — Solana track**.

## License

MIT
