import {
  x402HTTPClient,
  type PaymentRequired,
  type PaymentRequirements,
} from "@x402/fetch";
import type {
  PaymentAuthorization,
  ProviderAdapter,
  ProviderMetadata,
  ProviderQuote,
  ProviderRequest,
} from "./types.js";
import { providerFulfillment } from "./types.js";

export class X402ProviderError extends Error {
  constructor(
    readonly code:
      | "X402_EXPECTED_PAYMENT_REQUIRED"
      | "X402_INVALID_CHALLENGE"
      | "X402_UNSUPPORTED_PAYMENT"
      | "X402_PAYMENT_FAILED"
      | "X402_SETTLEMENT_MISSING"
      | "X402_SETTLEMENT_EXCEEDS_AUTHORIZATION",
    message: string,
  ) {
    super(message);
    this.name = "X402ProviderError";
  }
}

export type ProtocolHttpRequest = {
  url: string;
  init?: RequestInit;
};

export type X402ProviderOptions<TInput, TOutput> = {
  metadata: Omit<ProviderMetadata, "protocol">;
  httpClient: x402HTTPClient;
  paidFetch: typeof globalThis.fetch;
  unpaidFetch?: typeof globalThis.fetch;
  buildRequest: (request: ProviderRequest<TInput>) => ProtocolHttpRequest;
  decodeResponse?: (response: Response) => Promise<TOutput>;
  preferredSchemes?: readonly string[];
  selectRequirement?: (
    paymentRequired: PaymentRequired,
  ) => PaymentRequirements | undefined;
};

async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

async function defaultDecode<TOutput>(response: Response): Promise<TOutput> {
  return (await readBody(response)) as TOutput;
}

function positiveAtomic(value: string, label: string): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new X402ProviderError(
      "X402_INVALID_CHALLENGE",
      `${label} is not an integer atomic amount`,
    );
  }
  if (parsed <= 0n) {
    throw new X402ProviderError(
      "X402_INVALID_CHALLENGE",
      `${label} must be positive`,
    );
  }
  return parsed;
}

function selectByPreference(
  paymentRequired: PaymentRequired,
  preferredSchemes: readonly string[],
): PaymentRequirements | undefined {
  for (const scheme of preferredSchemes) {
    const match = paymentRequired.accepts.find(
      (requirement) => requirement.scheme === scheme,
    );
    if (match) return match;
  }
  return undefined;
}

function settlementMetadata(
  parsed: Awaited<ReturnType<x402HTTPClient["processResponse"]>>,
): Record<string, string> {
  const header = parsed.header;
  if (!header || !("success" in header)) {
    throw new X402ProviderError(
      "X402_SETTLEMENT_MISSING",
      "x402 paid response did not include a settlement receipt",
    );
  }
  if (!header.success) {
    throw new X402ProviderError(
      "X402_PAYMENT_FAILED",
      header.errorMessage ?? header.errorReason ?? "x402 settlement failed",
    );
  }

  const metadata: Record<string, string> = {
    "x402.paymentStatus": parsed.paymentStatus,
    "x402.success": "true",
  };
  if (header.transaction) metadata["x402.transaction"] = header.transaction;
  if (header.network) metadata["x402.network"] = String(header.network);
  if (header.payer) metadata["x402.payer"] = header.payer;
  if (header.amount) metadata["x402.amount"] = header.amount;
  return metadata;
}

export class X402ProviderAdapter<TInput = unknown, TOutput = unknown>
  implements ProviderAdapter<TInput, TOutput>
{
  readonly metadata: ProviderMetadata;
  private readonly unpaidFetch: typeof globalThis.fetch;
  private readonly preferredSchemes: readonly string[];

  constructor(private readonly options: X402ProviderOptions<TInput, TOutput>) {
    this.metadata = { ...options.metadata, protocol: "x402" };
    this.unpaidFetch = options.unpaidFetch ?? globalThis.fetch;
    this.preferredSchemes = options.preferredSchemes ?? ["upto", "exact"];
  }

  async quote(request: ProviderRequest<TInput>): Promise<ProviderQuote> {
    const target = this.options.buildRequest(request);
    const response = await this.unpaidFetch(target.url, target.init);

    if (response.status !== 402) {
      throw new X402ProviderError(
        "X402_EXPECTED_PAYMENT_REQUIRED",
        `expected x402 resource to return 402, received ${response.status}`,
      );
    }

    let paymentRequired: PaymentRequired;
    try {
      const body = await readBody(response.clone());
      paymentRequired = this.options.httpClient.getPaymentRequiredResponse(
        (name) => response.headers.get(name),
        body,
      );
    } catch (error) {
      throw new X402ProviderError(
        "X402_INVALID_CHALLENGE",
        `failed to decode x402 challenge: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    const requirement = this.options.selectRequirement
      ? this.options.selectRequirement(paymentRequired)
      : selectByPreference(paymentRequired, this.preferredSchemes);

    if (!requirement) {
      throw new X402ProviderError(
        "X402_UNSUPPORTED_PAYMENT",
        `x402 resource does not offer a supported scheme (${this.preferredSchemes.join(", ")})`,
      );
    }

    const priceAtomic = positiveAtomic(requirement.amount, "x402 requirement amount");

    return {
      providerId: this.metadata.id,
      requestId: request.requestId,
      mint: requirement.asset,
      priceAtomic,
      protocol: "x402",
      protocolMetadata: {
        "x402.version": String(paymentRequired.x402Version),
        "x402.scheme": requirement.scheme,
        "x402.network": String(requirement.network),
        "x402.payTo": requirement.payTo,
        "x402.resource": paymentRequired.resource.url || target.url,
      },
    };
  }

  async fulfillAuthorized(
    request: ProviderRequest<TInput>,
    quote: ProviderQuote,
    authorization: PaymentAuthorization,
  ) {
    const target = this.options.buildRequest(request);
    const response = await this.options.paidFetch(target.url, target.init);
    const parsed = await this.options.httpClient.processResponse(response.clone());

    if (!response.ok || parsed.paymentStatus === "settle_failed") {
      const reason =
        parsed.header && "errorMessage" in parsed.header
          ? parsed.header.errorMessage
          : undefined;
      throw new X402ProviderError(
        "X402_PAYMENT_FAILED",
        reason ?? `x402 paid request failed with HTTP ${response.status}`,
      );
    }

    const protocolMetadata = settlementMetadata(parsed);
    const settledAmount = protocolMetadata["x402.amount"];
    if (
      settledAmount !== undefined &&
      positiveAtomic(settledAmount, "x402 settled amount") > authorization.amountAtomic
    ) {
      throw new X402ProviderError(
        "X402_SETTLEMENT_EXCEEDS_AUTHORIZATION",
        "x402 settlement amount exceeds the Canalis authorization",
      );
    }

    const output = this.options.decodeResponse
      ? await this.options.decodeResponse(response)
      : await defaultDecode<TOutput>(response);

    return providerFulfillment(output, {
      ...protocolMetadata,
      ...(authorization.paymentReference
        ? { "canalis.paymentReference": authorization.paymentReference }
        : {}),
      "canalis.authorizedAtomic": quote.priceAtomic.toString(),
    });
  }
}
