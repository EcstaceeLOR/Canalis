# Canalis settlement finalization

Canalis treats each provider payment channel as a separate Solana escrow while presenting one logical task budget to the user.

The canonical terminal lifecycle follows the Solana Foundation payment-channels program:

1. inspect the current channel state,
2. apply the final cumulative voucher and cooperatively seal with `settle_and_seal`,
3. if no new voucher is needed, cooperatively seal at the current watermark (`hasVoucher = 0`),
4. call `distribute`,
5. persist the settlement/distribution transaction signatures,
6. link those signatures to Solana Explorer,
7. reconcile provider payout + payer refund against the original channel ceiling.

## Financial invariants

For each Canalis v1 provider channel:

```text
provider payout == authorized cumulative spend
payer refund == channel deposit ceiling - authorized cumulative spend
provider payout + payer refund == channel deposit ceiling
```

At task level:

```text
authorized spend == sum(provider payouts)
recovered == channel refunds + budget never reserved into channels
provider payouts + recovered == original task budget
```

`TaskFinalizationSummary.isReconciled` is true only when every provider channel finalized and all of the equations above hold.

## Adapter boundary

`PaymentChannelAdapter` remains the only chain-specific boundary. A production adapter is responsible for sending the canonical Solana payment-channel instructions and returning confirmed transaction signatures.

The terminal methods used by the coordinator are:

- `getChannel` — inspect authoritative on-chain state,
- `settleAndSeal` — apply a newer final voucher and seal,
- `sealCurrent` — cooperative `settle_and_seal(hasVoucher = 0)`,
- `distribute` — transfer the settled amount to the provider/distribution recipients and return unused escrow to the payer.

Canalis does not require private-key loading inside `@canalis/solana`; signer/RPC ownership belongs to the application/runtime adapter.

## Recovery semantics

Finalization is intentionally retry-safe and does not hide partial failures.

| Failure point | Canalis recovery action | Meaning |
| --- | --- | --- |
| channel inspection | `inspect-channel` | Confirm channel address/state or whether a previous run already reclaimed it. |
| final voucher / cooperative seal | `retry-settle-and-seal` | No distribution should occur until the final authorized watermark is sealed. |
| forced-close grace | `wait-for-forced-close` | Wait until sealing is permitted, then continue to distribution. |
| distribution | `retry-distribute` | The channel is already sealed; retry only distribution/refund, not payment authorization. |
| accounting mismatch | `inspect-channel` | Treat as an invariant violation and inspect on-chain state before marking the task reconciled. |

If `settle_and_seal` succeeds but `distribute` fails, Canalis preserves the settlement transaction signature in the recovery record. A retry can inspect the now-sealed channel and continue directly with distribution.

## Explorer records

Every successful transaction signature is stored with a cluster-aware explorer URL. Mainnet links use the base Solana Explorer transaction URL; devnet/testnet links include the relevant `cluster` query parameter.

No placeholder transaction signature should be presented as an on-chain settlement. Deterministic/fake adapters are for tests only.
