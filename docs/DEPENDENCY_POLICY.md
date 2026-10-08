# Dependency and install policy

Canalis uses Node.js 22, pnpm 10.17.1, and the committed root
`pnpm-lock.yaml` as the release dependency graph. CI and Vercel must install
with `pnpm install --frozen-lockfile`; a package manifest change without a
matching lockfile update is a release failure.

## Updating dependencies

1. Use Node.js 22 and the pnpm version declared in the root `package.json`.
2. Run `pnpm install` intentionally to update `pnpm-lock.yaml`.
3. Review the manifest and lockfile diff, including transitive Solana and x402
   changes.
4. Run `pnpm judge:check` before merging.
5. Re-run the devnet product proof when Solana, x402, wallet, token, or signing
   dependencies change.

## Native build scripts

The optional `bigint-buffer`, `bufferutil`, `esbuild`, and `utf-8-validate`
install scripts are explicitly ignored in `pnpm-workspace.yaml`. The current
product and judge path use their tested JavaScript/WASM fallbacks, avoiding
unreviewed dependency code execution during install. The fallback can emit a
`bigint: Failed to load bindings` warning; this is a performance warning, not a
correctness failure.

## Solana Kit peer warning

The locked x402 SVM package supports `@solana/kit >=5.1.0`, including the
locked Kit 6 release used by Canalis. Some generated transitive
`@solana-program/*` packages still advertise a narrower Kit 5 peer range, so a
fresh dependency resolution can report peer warnings. Canalis treats this as
an upstream metadata mismatch and validates the combination through the
Solana build, voucher/signature tests, live-x402 tests, finalization tests, and
the devnet proof. Do not suppress or override the peer range in the lockfile;
re-evaluate it during each x402/Solana dependency update.
