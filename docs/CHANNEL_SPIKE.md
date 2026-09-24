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

`packages/solana/src/types.ts` defines the blockchain boundary Canalis core will depend on. Higher-level code does not contain RPC/payment-channel implementation details.

### 4. x402 `upto` devnet server

`examples/channel-spike/src/server.ts` exposes a deterministic paid tool:

- maximum authorization: **100,000 atomic units**
- actual usage charge: **30,000 atomic units**
- expected unused amount returned to payer: **70,000 atomic units**

The server uses the official `@x402/svm/upto/server` implementation. Its receiver-authorizer key is generated ephemerally and does not hold funds.

### 5. Signer-injected client

`examples/channel-spike/src/client.ts` exposes `runChannelSpike(signer, resourceServerUrl)`.

The caller supplies a Solana signer from its own wallet, test harness, or key-management boundary. Canalis does not load a production payer secret in this spike.

### 6. Reproducible funded devnet proof

`examples/channel-spike/src/devnet-funded-proof.ts` runs the complete lifecycle against Solana devnet with a deliberately public, devnet-only test identity. The script has a genesis-hash guard and refuses to run outside devnet.

The proof creates a disposable SPL test mint, payer/provider token accounts, the canonical devnet payment-channel treasury ATA, a local x402 facilitator, and a protected resource server. Client spend controls whitelist only the generated proof mint and enforce the same 100,000-unit maximum used by the channel.

The live proof is intentionally **manual-only** in GitHub Actions because it consumes devnet SOL and depends on a public RPC. Normal tests, typechecking, and security checks still run on pushes and pull requests.

## Expected on-chain lifecycle

For one successful request, x402 SVM `upto` performs the payment-channel lifecycle:

```text
client challenge
     ↓
open channel with 100,000-unit ceiling
     ↓
provider performs work
     ↓
provider authorizes cumulative 30,000-unit voucher
     ↓
settle_and_seal
     ↓
distribute 30,000 to provider
     ↓
return unused 70,000 to payer
```

The important invariant is that the resource server can settle **at most** the amount authorized by the payment channel, never beyond the deposited ceiling.

## Successful devnet evidence

The funded proof passed in GitHub Actions run **36038985080** on 2026-09-24.

### Addresses

- proof mint: `BewPkz9eV7JpKJ2G6VfFpxhFqLtFTnxkoBQTzLRm8ott`
- payer: `HAufDEZaeaexu8NXSyBzdfnLzLrJoyxa58zWSFPtvALf`
- provider: `4G5NkehL9uxXDaYaU75V28eHroACyuz6tFZAcUqUZzZw`
- facilitator: `8DbsEABfC2Tepct35HJrkW11A1P8KptinM6W6Vh3PrUV`
- receiver authorizer: `6wgh84qVfT3nocxdVge27M5YWhrUAWV8Ro418oPf6yfC`
- canonical treasury ATA for the proof mint: `E4vNVRucVj9zQVPjejfSEpVjHLGghr9hsLf64GvHSdiH`
- channel: `F5hPXLV3WRRaVNMrcM7PteNBCwf78wWhG1JfnQdAqmWH`

### Transactions

- channel open / 100,000-unit deposit:
  `3YYFh1SuCj6PDY9d6bqo8t5dJoWKdprDo7YQaqL7HQM4ftwjLqj7Gs58fkpxvvPbXyLFzUe2SARDXad7e9dktcik`
- 30,000-unit claim / settlement:
  `3phVuohoPwQ1fojrPGUVg2mEPqb2P8agNtGro7nQtXNB5VzumP7NVNpBEYzf8L9eXxHqHHUQpKpHp2mvNZyitfRu`

Explorer links:

- channel: https://explorer.solana.com/address/F5hPXLV3WRRaVNMrcM7PteNBCwf78wWhG1JfnQdAqmWH?cluster=devnet
- open transaction: https://explorer.solana.com/tx/3YYFh1SuCj6PDY9d6bqo8t5dJoWKdprDo7YQaqL7HQM4ftwjLqj7Gs58fkpxvvPbXyLFzUe2SARDXad7e9dktcik?cluster=devnet
- claim transaction: https://explorer.solana.com/tx/3phVuohoPwQ1fojrPGUVg2mEPqb2P8agNtGro7nQtXNB5VzumP7NVNpBEYzf8L9eXxHqHHUQpKpHp2mvNZyitfRu?cluster=devnet

### Balance proof

| Measurement | Before | After | Delta |
| --- | ---: | ---: | ---: |
| payer test-token balance | 200,000 | 170,000 | -30,000 |
| provider test-token balance | 0 | 30,000 | +30,000 |

Therefore:

- authorized maximum: **100,000**
- actual settled amount: **30,000**
- payer spent: **30,000**
- provider received: **30,000**
- unused amount recovered by payer: **70,000**

The deposited ceiling was not treated as the charge. Only the cumulative authorized usage was distributed to the provider; the remainder returned to the payer.

### CI artifact

The successful run uploaded `canalis-devnet-payment-channel-proof` with artifact ID **10826325710** and SHA-256 digest:

`bf0f2a02b14c2469d4b631e8de2dfe5d3ba9f824bd8fa63a9a3968602bf4c1c8`

## Devnet reliability note

Solana's public devnet RPC returned transient HTTP 429 responses immediately after the deposit transaction. The proof retries only a failed **claim** response that contains **no transaction signature**, using bounded backoff. It never retries a settlement response that may already have been broadcast. The final claim then succeeded and produced the transaction recorded above.

The temporary proof mint also requires the canonical devnet treasury ATA expected by the Solana payment-channels program. The proof creates this account explicitly before opening the channel.

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

For the full funded proof, use the manual `devnet-proof` GitHub Actions job or run:

```bash
pnpm --filter @canalis/channel-spike devnet:proof
```

Never send mainnet SOL or production assets to the public devnet proof identity.

## Verification status

### Proven in source/tests

- [x] no custom payment-channel smart contract introduced
- [x] canonical voucher size and byte layout
- [x] bigint-safe encode/decode
- [x] Ed25519 signing and verification helpers
- [x] monotonic cumulative-amount guard
- [x] deposit-ceiling guard
- [x] typed Canalis channel boundary
- [x] official x402 SVM `upto` server/client/facilitator integration
- [x] fixed 100,000-unit channel ceiling
- [x] real devnet channel opened successfully
- [x] provider settled exactly 30,000 units
- [x] payer spent exactly 30,000 units
- [x] provider received exactly 30,000 units
- [x] 70,000 unused units returned to payer
- [x] channel and transaction signatures captured
- [x] normal repository tests, typecheck, and security checks pass
- [x] funded devnet proof passes end to end

Issue #1's payment primitive is proven and ready to be reused by the higher-level Canalis product layers.
