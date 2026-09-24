# Canalis product information architecture

Issue #23 replaces the original single-page control plane with a public product surface and a separate operator application.

## Surface model

### Public surface

`/` is the Canalis product landing page. It explains bounded agent spend, machine-service routing, payment-channel settlement, and links directly to real devnet proof. It does not use the authenticated/operator shell.

### Product surface

All application routes share one persistent shell:

- desktop sidebar with Workspace and Control navigation groups,
- persistent top bar with breadcrumbs, network context, command search, and a task action,
- mobile drawer plus bottom navigation for primary workspaces,
- `Cmd/Ctrl + K` command entry for fast route/proof navigation,
- consistent page header, metric, card, table, empty, loading, and error patterns.

## Route map

| Route | Purpose today | Later domain issue |
| --- | --- | --- |
| `/dashboard` | truthful operational overview and verified proof | Dashboard/Analytics |
| `/tasks` | task workspace entry and reference workflow | Persistent Tasks |
| `/tasks/demo` | interactive deterministic policy/orchestration task | Task detail + live execution |
| `/channels` | real devnet channel and accounting evidence | Channel workspace |
| `/providers` | current deterministic provider surface | Provider Registry |
| `/transactions` | real devnet transaction evidence | Transactions & Receipts |
| `/policies` | current reference policy and invariant | Reusable Policies |
| `/analytics` | analytics derived only from reference data | Operational Analytics |
| `/settings` | truthful runtime/security state | Settings & Integrations |

## Data honesty rules

The rebuilt frontend distinguishes three sources of state:

1. **Interactive deterministic state** — produced by `/api/demo` during the current session.
2. **Verified devnet evidence** — sourced from the successful payment-channel proof recorded in `docs/CHANNEL_SPIKE.md`.
3. **Empty user state** — shown where persistence/account data does not exist yet.

The UI must never invent transaction signatures, persisted user history, provider health results, integration secrets, or saved settings.

## Interaction model

Index pages use dense but readable cards/tables. Detail pages expose execution/accounting context. Primary action placement stays in page headers. Mobile navigation prioritizes Dashboard, Tasks, Channels, Providers, and Transactions; Control pages remain available through the drawer and command search.

The original one-page hero/composer/payment graph/settlement layout is no longer the application architecture. Useful functionality is decomposed by domain, with the deterministic task runner living under `/tasks/demo` and real settlement evidence under Channels/Transactions.
