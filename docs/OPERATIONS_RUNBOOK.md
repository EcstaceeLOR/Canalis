# Canalis operations runbook

## Production topology

- Canonical Vercel project: `demola-codes/canalis-sigma`
- Canonical URL: <https://canalis-sigma.vercel.app>
- Production data: the `canalis-production` Neon resource, attached only to Vercel Production
- Preview/development data: the isolated `canalis-preview` Neon resource
- Runtime traffic uses pooled `DATABASE_URL`; migrations and recovery tooling use direct `DATABASE_URL_UNPOOLED`.

The stale `demola-codes/canalis` Vercel project was permanently removed on 2026-10-09 so one Git repository produces one release status and one canonical deployment.

## Required environment

| Variable | Scope | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Production; Preview/Development | Pooled application traffic |
| `DATABASE_URL_UNPOOLED` | Production; Preview/Development | Migrations and recovery only |
| `CANALIS_PROVIDER_SECRET_KEY` | Secret, distinct per data environment | AES-256-GCM provider credentials |
| `CANALIS_DEVELOPER_SECRET_KEY` | Secret, distinct per data environment | AES-256-GCM webhook signing secrets |

Never print, pull, or commit production secret values. Rotating either encryption key requires decrypting every affected envelope with the old key and re-encrypting with the new key before the old value is removed. Because the current envelopes are versioned `v1` but do not carry a key identifier, treat key rotation as a maintenance-window migration, verify reads, then redeploy.

## Release procedure

1. Open a pull request and wait for `verify`, local `judge-path`, Vercel preview deployment, and `preview-judge-path`.
2. Confirm the preview health response reports `status: ok` and `durableStorage: connected`.
3. Merge only after required checks pass. Vercel deploys `main` to Production.
4. Confirm `/`, `/tasks/demo`, and `/api/health` on the canonical URL return HTTP 200.
5. Run one wallet-scoped task, record its ID, redeploy without a schema change, and confirm that exact task remains readable.
6. Record the Vercel deployment URL, Git commit, health response, and GitHub Actions run in the release issue.

The Vercel build runs schema migration before `next build` and serializes it with a Postgres advisory lock. On Neon, the migration uses `DATABASE_URL_UNPOOLED`; request-time repositories use the pooled URL and never run schema work during a function cold start.

## Monitoring and alerting

The `production-smoke` GitHub Actions workflow runs every 15 minutes and checks the canonical landing page, judge path, and a live database query through `/api/health`. A failed workflow is the uptime alert and should remain enabled in repository Actions notifications.

Operational diagnosis sources:

- Vercel Observability and function logs: HTTP 5xx rate, route errors, latency, and release correlation.
- Canalis Activity and Transactions workspaces: provider/webhook failures, retry state, channel finalization, distribution, and payer recovery.
- `/api/health`: release commit plus live database connectivity; it never returns credentials.

External error-monitoring products require a separate vendor account. Do not paste a vendor token into code; attach one through Vercel Marketplace and store server tokens as Vercel Secrets if the team selects a provider.

## Incident response

1. Acknowledge the alert and write down the first failed timestamp, route, release commit, and correlation/request ID.
2. Check `/api/health`. `not-configured` means missing environment binding; `unavailable` means the configured database could not answer within the connection timeout.
3. Compare Vercel logs with Canalis activity records. Never copy credential envelopes, cookies, wallet signatures, or database URLs into an issue.
4. For webhook/provider failures, disable the affected provider or subscription, retain the durable failure record, and retry only through the idempotent recovery action.
5. For partial channel finalization, do not reopen or recreate the channel. Resume the persisted distribute/recover step and verify the real Explorer transaction before marking it complete.
6. If the release introduced the fault, use Vercel rollback to the last known-good Production deployment. Database migrations are forward-only; apply a reviewed compensating migration rather than deleting migration history.
7. Close the incident only after the smoke workflow passes and the affected durable record is verified.

## Backup and restore

Neon provides point-in-time restore through retained history. For a production recovery, create a branch at the last known-good timestamp, inspect it, and promote/restore only after record counts and representative wallet-scoped tasks match expectations. Never rehearse destructive restore steps against Production.

The repository also includes a narrowly guarded logical restore rehearsal for the isolated preview database:

```bash
CANALIS_ALLOW_RESTORE_DRILL=preview pnpm --filter @canalis/persistence ops:restore-drill
```

It requires the preview `DATABASE_URL_UNPOOLED`, creates only `canalis_restore_drill`, backs up its rows in memory, drops and recreates that dedicated table, restores/verifies the marker, and removes the drill table. Record the date and output in the release issue. It never touches application tables.

Rehearsal record: on 2026-10-09 the isolated preview database restored and verified one marker row successfully, then removed the drill table.

## Rollback decision

- Application-only regression: roll back the Vercel deployment.
- Additive migration plus application regression: roll back application only if the previous build tolerates the additive schema.
- Destructive/incompatible schema change: keep the current application online in maintenance mode and ship a reviewed compensating migration; do not point old code at an incompatible schema.
- Data corruption: stop writes, create a Neon point-in-time branch, validate, then follow the Neon restore procedure with a second maintainer reviewing the timestamp and target.
