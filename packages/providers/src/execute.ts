import { createHash } from "node:crypto";
import type {
  ExecuteProviderOptions,
  PaymentAuthorization,
  PaymentAuthorizer,
  ProviderAdapter,
  ProviderQuote,
  ProviderRequest,
  ProviderResult,
} from "./types.js";

function assertQuoteMatchesRequest(
  providerId: string,
  requestId: string,
  quote: ProviderQuote,
): void {
  if (quote.providerId !== providerId) {
    throw new Error("provider quote belongs to a different provider");
  }
  if (quote.requestId !== requestId) {
    throw new Error("provider quote belongs to a different request");
  }
  if (quote.priceAtomic <= 0n) {
    throw new Error("provider quote must have a positive price");
  }
}

function assertAuthorizationMatchesQuote(
  quote: ProviderQuote,
  authorization: PaymentAuthorization,
): void {
  if (authorization.providerId !== quote.providerId) {
    throw new Error("payment authorization provider mismatch");
  }
  if (authorization.requestId !== quote.requestId) {
    throw new Error("payment authorization request mismatch");
  }
  if (authorization.mint !== quote.mint) {
    throw new Error("payment authorization mint mismatch");
  }
  if (authorization.amountAtomic !== quote.priceAtomic) {
    throw new Error("payment authorization amount mismatch");
  }
  if (authorization.protocol !== quote.protocol) {
    throw new Error("payment authorization protocol mismatch");
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function hashProviderResponse(output: unknown): string {
  return createHash("sha256").update(stableJson(output)).digest("hex");
}

export async function executeProviderRequest<TInput, TOutput>(
  provider: ProviderAdapter<TInput, TOutput>,
  request: ProviderRequest<TInput>,
  authorizer: PaymentAuthorizer,
  options: ExecuteProviderOptions = {},
): Promise<ProviderResult<TOutput>> {
  const quote = await provider.quote(request);
  assertQuoteMatchesRequest(provider.metadata.id, request.requestId, quote);

  // This await is deliberately before fulfillment. A denied or malformed
  // authorization means paid work is never returned.
  const authorization = await authorizer.authorize(quote);
  assertAuthorizationMatchesQuote(quote, authorization);

  const output = await provider.fulfillAuthorized(request, quote, authorization);
  const nowUnixSeconds =
    options.nowUnixSeconds ?? (() => BigInt(Math.floor(Date.now() / 1000)));

  return {
    output,
    receipt: {
      providerId: quote.providerId,
      requestId: quote.requestId,
      mint: quote.mint,
      priceAtomic: quote.priceAtomic,
      protocol: quote.protocol,
      authorizationId: authorization.authorizationId,
      paymentReference: authorization.paymentReference,
      responseHash: hashProviderResponse(output),
      timestampUnixSeconds: nowUnixSeconds(),
    },
  };
}
