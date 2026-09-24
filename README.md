# Canalis

**The payment orchestration layer for autonomous agents.**

Canalis gives an AI agent a bounded spending budget, lets it purchase multiple paid services during a task, records every payment as a verifiable flow, settles through Solana payment channels, and returns unused funds to the payer.

> Give an agent a budget. Canalis handles everything it pays for.

## Why Canalis

Agentic commerce breaks when every tool call requires a fresh onchain payment and every provider has a separate billing relationship. Solana payment channels solve the settlement-frequency problem by escrowing a spending ceiling once, authorizing cumulative spend with signed offchain vouchers, and settling actual usage later.

Canalis builds the missing orchestration layer above that primitive:

- **Budgeted sessions** — authorize a maximum amount for one agent task.
- **Multi-provider routing** — pay several tools/services inside one workflow.
- **Policy controls** — restrict providers, per-call spend, total spend, and expiry.
- **Verifiable payment graph** — see exactly where a task spent money.
- **Receipts** — link purchased services to payment authorization and task output.
- **Settlement & refund** — settle actual usage and recover unused budget.

## MVP demo

1. User creates a `$1.00` task budget.
2. Canalis opens one or more capped Solana payment channels.
3. An agent calls three paid demo services (for example: search, inference, and data lookup).
4. Each service call advances a cumulative signed voucher offchain.
5. The dashboard updates the task's payment graph in real time.
6. Canalis settles the channels onchain.
7. Providers receive the authorized amounts and unused funds return to the payer.

## Architecture

```text
User / Agent Owner
       |
       v
+----------------------+       +----------------------+
| Canalis Control Plane|------>| Policy Engine        |
| task + budget        |       | caps / allowlists    |
+----------+-----------+       +----------------------+
           |
           v
+----------------------+       +----------------------+
| Route Orchestrator   |------>| Provider Adapters    |
| task payment graph   |       | MPP / x402 / demo    |
+----------+-----------+       +----------+-----------+
           |                              |
           v                              v
+-----------------------------------------------------+
| Solana Payment Channels                            |
| open -> vouchers -> settle/seal -> distribute      |
+-----------------------------------------------------+
           |
           v
   Providers + refund
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the locked MVP architecture.

## What we are deliberately NOT building

To keep the hackathon entry focused on the actual innovation, v1 will not include:

- a new payment-channel smart contract,
- custom blockchain infrastructure,
- unnecessary Kubernetes/Terraform/platform scaffolding,
- a general-purpose wallet,
- a generic x402 marketplace,
- production-scale accounting or enterprise administration.

The judging demo should make the Canalis primitive obvious in under three minutes.

## Status

🚧 Active development for Colosseum Crypto World's Fair 2026 — Solana track.

## License

MIT
