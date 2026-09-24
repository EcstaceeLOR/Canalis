export const devnetProof = {
  channel: "F5hPXLV3WRRaVNMrcM7PteNBCwf78wWhG1JfnQdAqmWH",
  payer: "HAufDEZaeaexu8NXSyBzdfnLzLrJoyxa58zWSFPtvALf",
  provider: "4G5NkehL9uxXDaYaU75V28eHroACyuz6tFZAcUqUZzZw",
  mint: "BewPkz9eV7JpKJ2G6VfFpxhFqLtFTnxkoBQTzLRm8ott",
  ceiling: "100,000",
  settled: "30,000",
  recovered: "70,000",
  openSignature: "3YYFh1SuCj6PDY9d6bqo8t5dJoWKdprDo7YQaqL7HQM4ftwjLqj7Gs58fkpxvvPbXyLFzUe2SARDXad7e9dktcik",
  settleSignature: "3phVuohoPwQ1fojrPGUVg2mEPqb2P8agNtGro7nQtXNB5VzumP7NVNpBEYzf8L9eXxHqHHUQpKpHp2mvNZyitfRu",
  runId: "36038985080",
} as const;

export const referenceProviders = [
  { id: "search", name: "Canalis Search", price: "$0.05", protocol: "Deterministic", status: "ready", role: "External evidence" },
  { id: "data", name: "Canalis Data", price: "$0.03", protocol: "Deterministic", status: "ready", role: "Structured lookup" },
  { id: "inference", name: "Canalis Inference", price: "$0.12", protocol: "Deterministic", status: "ready", role: "Evidence synthesis" },
] as const;

export const referencePolicy = {
  name: "Reference bounded-spend policy",
  budget: "$1.00 USDC",
  maxPerCall: "$0.25 USDC",
  providers: "Search · Data · Inference",
  network: "Solana devnet",
} as const;

export function shortAddress(value: string, left = 7, right = 5) {
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

export function explorerTx(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function explorerAddress(address: string) {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}
