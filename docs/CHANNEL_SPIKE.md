# Channel Spike — Issue #1

## Purpose

This spike proves the payment primitive Canalis will build on before we add routing, policy, receipts, or UI.

Canalis does **not** implement a new payment-channel smart contract. It uses Solana's canonical payment-channels program and the published x402 SVM `upto` scheme for interoperable HTTP payments.

Canonical program id:

`CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX`

Devnet network id:

`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`

## What is implemented

### 1. Canonical voucher codec

`packages/solana/src/voucher.ts` pins the exact 50-byte voucher layout:

```text
0..2    [0x56, 0x01]
2..34   channel PDA bytes
34..42  cumulative amount (u64 LE)
42..50  expiry unix timestamp (i64 LE; 0 means no expiry)
```

The package rejects malformed channel ids, out-of-range integers, non-increasing cumulative values, and values above the deposit ceiling.

### 2. Voucher signatures

`packages/solana/src/signature.ts` signs the canonical voucher bytes with Ed25519 through `@solana/kit` and verifies them against the corresponding public key.

### 3. Channel adapter boundary

`packages/solana/src/types.ts` defines the blockchain boundary Canalis core will depend on. Higher-level code will not contain RPC/payment-channel implementation details.

### 4. x402 `upto` devnet server

`examples/channel-spike/src/server.ts` exposes a deterministic paid tool:

- maximum authorization: **$0.10**
- actual usage charge: **$0.03**
- expected unused amount returned to payer: **$0.07**

The server uses the official `@x402/svm/upto/server` implementation. Its receiver-authorizer key is generated ephemerally at boot and does not hold funds.

### 5. Signer-injected client

`examples/channel-spike/src/client.ts` exposes `runChannelSpike(signer, resourceServerUrl)`.

The caller supplies a Solana signer from its own wallet, test harness, or key-management boundary. Canalis does not load or commit payer secrets in this spike.

## Expected on-chain lifecycle

For one successful request, x402 SVM `upto` performs the payment-channel lifecycle:

```text
client challenge
     ↓
open channel with $0.10 ceiling
     ↓
provider performs work
     ↓
provider authorizes cumulative $0.03 voucher
     ↓
settle_and_seal
     ↓
distribute $0.03 to provider
     ↓
return unused $0.07 to payer
```

The important invariant is that the resource server can settle **at most** the amount authorized by the payment channel, never beyond the deposited ceiling.

## Running the server

From the repository root:

```bash
pnpm install
cp examples/channel-spike/.env.example examples/channel-spike/.env
pnpm --filter @canalis/channel-spike server
```

The server requires:

- a Solana devnet payee address,
- an x402 facilitator URL that supports the SVM `upto` scheme,
- optionally a custom devnet RPC URL.

No private key belongs in `.env` for this server spike.

## Running the payer side

Import the client function from the example and pass a **devnet/test signer** from the calling environment:

```ts
const result = await runChannelSpike(devnetSigner);
```

The payer must hold the devnet test asset required by the selected facilitator/resource configuration. Do not use production funds for this spike.

## Verification status

A single repository workflow at `.github/workflows/ci.yml` runs tests and typechecks for pushes and pull requests.

### Proven in source/tests

- [x] canonical voucher size and byte layout
- [x] bigint-safe encode/decode
- [x] Ed25519 signing and verification helpers
- [x] monotonic cumulative-amount guard
- [x] deposit-ceiling guard
- [x] typed Canalis channel boundary
- [x] official x402 SVM `upto` server/client integration wired
- [x] CI tests and TypeScript typecheck pass on PR #9

### Still required before closing Issue #1

- [ ] perform one funded **devnet-only** request through a compatible facilitator
- [ ] capture channel/settlement transaction signatures
- [ ] verify provider receives the actual amount, not the ceiling
- [ ] verify unused amount is returned to payer

Issue #1 stays open until those on-chain checks are evidenced.
