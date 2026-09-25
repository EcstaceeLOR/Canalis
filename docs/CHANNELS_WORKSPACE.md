# Channels workspace

`/channels` is the operational surface for payment channels owned by the authenticated payer wallet.

## Canonical data

The workspace reads persisted `tasks`, `channels`, provider metadata, flows, receipts, settlements, transaction signatures, and recovery state through the application/persistence layer. It does not maintain a second browser-side channel ledger.

Every query is scoped to the wallet address in the authenticated session. A channel detail request also re-checks task ownership before returning state or accepting an action.

## Status model

The UI derives an operational status from the canonical channel/task state:

- **reserved** — a task has a provider ceiling but no live channel has been opened yet.
- **active** — an open, non-expired channel belongs to an active task.
- **recoverable** — an open channel belongs to a terminal task and still contains unused payer escrow.
- **sealed** — a persisted sealed channel awaiting its next canonical lifecycle step.
- **settled** — provider authorization has been distributed and the channel is terminal.
- **recovered** — a zero-spend/unused channel has returned escrow to the payer and is terminal.
- **expired** — a non-terminal channel has passed its task expiry.
- **needs recovery** — a failed or ambiguous terminal attempt requires inspection before any rebroadcast.

## Terminal actions

Canalis's live x402 `upto` channel integration exposes a terminal **claim** operation. For the live product this is intentionally presented as one safe operation rather than pretending there are three independent user actions.

### Finalize

For a channel with authorized spend, **Finalize** claims the persisted cumulative authorization. The x402 payment-channel path settles/seals the authorized amount, distributes the provider payout, and returns unused escrow to the payer. Canalis then persists the real terminal transaction signature and reconciliation amounts.

### Recover unused

For an eligible open channel with zero cumulative authorization, **Recover unused** executes the same terminal channel path with zero provider settlement so the unused ceiling can return to the payer.

### Inspect recovery

If a prior terminal attempt may have reached Solana but confirmation is ambiguous, automatic rebroadcast is blocked. The workspace exposes the persisted recovery stage, retry state, and any real Explorer evidence instead. Operators must reconcile that evidence before another terminal transaction can be permitted.

## Safety invariants

- Terminal `distributed` and `recovered` channels are idempotent and cannot be paid twice.
- A channel cannot finalize while its task is still active and unexpired.
- A channel cannot be operated on the wrong Solana network; the current live path is devnet-only.
- Ambiguous or failed terminal attempts are never blindly rebroadcast.
- Explorer links are rendered only from persisted real channel addresses or transaction signatures.
- For a terminal claim, `provider settlement + payer refund = channel ceiling`.

## Navigation

Channel details link back to the owning task and to the provider and transaction workspaces so operational evidence can be traced across the product without duplicating state.
