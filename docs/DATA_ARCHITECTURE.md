# Canalis application and data architecture

Issue #24 removes the deployment-only copy of Canalis orchestration logic from `apps/web` and restores one canonical execution path.

## Boundaries

- `@canalis/core` owns policy evaluation, ledger accounting, routing, payment graphs, and settlement records.
- `@canalis/providers` owns deterministic, x402, and MPP provider adapters.
- `@canalis/solana` owns the canonical Solana payment-channel constants, voucher/finalization boundaries, and chain-specific logic.
- `@canalis/application` owns application use-cases, validated request contracts, repository interfaces, and serialization for API clients.
- `@canalis/persistence` implements the repository against Postgres and owns versioned SQL migrations.
- `apps/web` is an HTTP/UI adapter. It does not implement policy or provider execution itself.

## Durable model

The initial migration persists:

- tasks and their lifecycle status,
- spending policies and provider caps,
- provider registry metadata,
- channel reservations, addresses, signatures, and recovery state,
- route flows and policy rejections,
- provider receipts,
- settlement transaction records.

Private keys and seed phrases are not schema fields and must never be persisted. Signing remains wallet-bound or server-side behind a dedicated signer boundary.

## API

Canonical endpoints:

- `POST /api/tasks` — validate and persist a task with provider channel reservations.
- `GET /api/tasks?limit=50` — list durable tasks.
- `GET /api/tasks/:id` — query the task, payment graph, channels, receipts, settlements, and recovery state.
- `POST /api/tasks/:id/execute` — execute an active deterministic task through `@canalis/core` and `@canalis/providers`, then persist the graph atomically.
- `GET /api/providers` — query the persisted provider registry.

`POST /api/demo` is a deprecated compatibility alias. It creates and executes a deterministic task using exactly the same application service and database path; there is no separate demo implementation.

API failures use `{ error: { code, message, details? } }` with stable application error codes. Database/internal errors never expose credentials.

## Migrations

Set `DATABASE_URL`, then run:

```bash
pnpm --filter @canalis/persistence db:migrate
```

Migrations are ordered SQL files under `packages/persistence/migrations/` and recorded in `canalis_schema_migrations`.

## CI durability proof

The main CI job starts PostgreSQL 16, applies the migration, and runs both repository and HTTP-route integration tests. The persistence test:

1. creates and executes a task,
2. closes the first database client,
3. creates a new repository/application instance,
4. reloads the same flows, receipts and channels,
5. persists channel finalization/recovery metadata,
6. closes again and reloads that metadata with a third instance.

This models process restart/redeploy rather than relying on process memory.

## Production configuration

Production requires a durable Postgres database and `DATABASE_URL` in the server runtime. There is deliberately no production in-memory fallback: without storage configuration, persistence APIs return `STORAGE_NOT_CONFIGURED` with HTTP 503.

The Vercel project builds from the monorepo root with npm workspaces, while local development and CI continue to use pnpm. Both paths build the same canonical packages and the same Next.js app.
