# Canalis judge path

This document is the reproducible Colosseum Crypto World's Fair demo path for Canalis.

## One-sentence pitch

**Give an autonomous agent one bounded budget. Canalis governs every provider payment, records the payment graph, settles actual usage through Solana payment channels, and recovers unused funds.**

## Deterministic judge configuration

Use this configuration for the reliable product demo:

| Setting | Value |
| --- | --- |
| Task budget | `1.00 USDC` |
| Per-call cap | `0.25 USDC` |
| Providers | Search, Data, Inference |
| Search price | `0.05 USDC` |
| Data price | `0.03 USDC` |
| Inference price | `0.12 USDC` |
| Total authorized spend | `0.20 USDC` |
| Recoverable budget | `0.80 USDC` |
| Solana cluster for live proof | `devnet` |

The deterministic mode uses the real Canalis policy engine, route orchestrator, provider interface, cumulative authorization accounting, receipts, and payment graph. It intentionally does **not** invent transaction signatures. Live on-chain or protocol proof must come from actual x402/MPP/Solana execution.

## Fresh-environment reproduction

Prerequisites: Node.js 22+ and pnpm 10.17.1.

```bash
git clone https://github.com/EcstaceeLOR/Canalis.git
cd Canalis
cp .env.example .env
pnpm install --no-frozen-lockfile
pnpm judge:check
pnpm dev
```

Open `http://localhost:3000`.

A successful `pnpm judge:check` means:

- all workspace packages build,
- all unit/integration/adversarial tests pass,
- TypeScript passes,
- the committed-file secret scan passes.

## Under-three-minute presentation

### 0:00–0:20 — Problem

> Autonomous agents can call multiple paid services, but giving an agent an unrestricted wallet is unsafe and paying onchain for every tiny API action is inefficient. Canalis gives the task—not the agent wallet—a bounded spending policy.

Show the Canalis landing screen and the `$1.00` task budget.

### 0:20–0:45 — Policy

Point out:

- `$1.00` total ceiling,
- `$0.25` max per call,
- explicit Search/Data/Inference allowlist.

Say:

> Every payment must pass this policy before paid work is returned.

### 0:45–1:25 — Run the task

Click **Run autonomous task**.

The judge should see three flows appear:

1. Search — `$0.05`
2. Data — `$0.03`
3. Inference — `$0.12`

Total authorized spend should be `$0.20`; recoverable capacity should be `$0.80`.

### 1:25–1:55 — Inspect one payment

Click a payment flow and show:

- provider,
- quoted price,
- cumulative authorization,
- Canalis payment reference,
- response hash.

Explain that each provider route has its own payment-channel ceiling while Canalis exposes one task-level budget.

### 1:55–2:25 — Solana-specific primitive

Show the architecture section or repository code and explain:

> Canalis does not deploy another payment-channel contract. It orchestrates Solana's payment-channel lifecycle: escrow once, advance cumulative signed vouchers offchain, then settle/seal and distribute actual usage. Unused escrow is returned to the payer.

The important financial invariant is:

```text
provider payout + payer refund = provider channel ceiling
```

And after every task channel is terminal:

```text
provider payouts + recovered funds = original task budget
```

### 2:25–2:45 — Live proof

If live protocol/on-chain evidence is configured, show:

- one real x402 or MPP paid resource call,
- the resulting protocol metadata in the Canalis receipt graph,
- Solana settlement/distribution transaction links.

If external infrastructure is unavailable, do **not** substitute fake transactions. State that the deterministic path is the reliability fallback and show the tested finalization/recovery code plus prior real transaction proof if available.

### 2:45–3:00 — Close

> Canalis lets autonomous agents spend quickly without giving up financial control: one budget, many services, explicit policy, verifiable receipts, Solana settlement, and automatic recovery of what the agent did not use.

## Judge proof checklist

Before recording or presenting:

- [ ] `pnpm judge:check` is green on the exact submission commit.
- [ ] Dashboard loads from a fresh install.
- [ ] `$1.00 / $0.25 / three providers` produces exactly `$0.20` authorized and `$0.80` recoverable.
- [ ] At least one policy-rejection path is ready to demonstrate if asked.
- [ ] x402/MPP integration tests are green.
- [ ] Solana voucher/finalization tests are green.
- [ ] Any transaction link shown is a genuine transaction signature.
- [ ] No private key, seed phrase, or signer secret is stored in the repository or browser UI.

## Deployment configuration

For Vercel, import the GitHub repository and set **Root Directory** to `apps/web`. The checked-in `apps/web/vercel.json` builds the required workspace packages before the Next.js app.

Environment defaults can be copied from `.env.example`. Deterministic mode requires no wallet secret. Live signers stay outside the repository and must be injected by the wallet/runtime boundary.
