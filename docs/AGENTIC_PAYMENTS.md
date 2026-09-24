# Agentic payment adapters

Canalis keeps HTTP payment protocols behind `@canalis/providers`. `@canalis/core` only sees a provider quote, a policy decision, and a receipt.

## x402

`X402ProviderAdapter` uses the official `x402HTTPClient` to decode `402 Payment Required` declarations and settlement receipts. The caller injects a payment-enabled fetch created by the official x402 client stack.

The adapter prefers `upto` before `exact` by default because `upto` matches Canalis' capped-usage model.

```ts
const provider = new X402ProviderAdapter({
  metadata: {
    id: "search",
    name: "Paid search",
    payee: "provider-wallet",
    description: "x402 search provider",
  },
  httpClient,
  paidFetch: fetchWithPayment,
  buildRequest: ({ input }) => ({
    url: "https://provider.example/search",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  }),
});
```

The unpaid request is used only to read the runtime payment declaration. Canalis evaluates the resulting atomic quote before `paidFetch` can run. Settlement metadata such as scheme, network, amount, payer, and transaction reference is attached to the normal `ProviderReceipt`.

## MPP

`MppProviderAdapter` implements the standard HTTP `Payment` challenge and `Payment-Receipt` wire format. Pass a payment-enabled fetch created by `mppx` (`Mppx.create(...).fetch` or `Fetch.from(...)`).

For `charge`, the challenge amount becomes the Canalis quote. For `session`, Canalis multiplies the challenge's atomic unit price by the caller-supplied capped unit count.

```ts
const provider = new MppProviderAdapter({
  metadata: {
    id: "inference",
    name: "Metered inference",
    payee: "provider-wallet",
    description: "MPP session provider",
  },
  paidFetch: mppFetch,
  buildRequest: ({ input }) => ({
    url: "https://provider.example/inference",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  }),
  sessionUnits: ({ input }) => input.maxUnits,
});
```

The runtime `402` challenge remains authoritative. Canalis never stores a wallet private key or seed; signer/payment-client setup stays at the application boundary.

## Failure behavior

Both adapters fail explicitly when:

- the endpoint does not return a payment challenge,
- the offered payment method/scheme is unsupported,
- challenge amounts are malformed,
- the paid request fails,
- a required payment receipt is missing,
- or an x402 settlement reports more than the amount Canalis authorized.

The deterministic demo providers remain available for the judge flow when an external paid service is unavailable.
