import type {
  PaymentAuthorization,
  ProviderAdapter,
  ProviderMetadata,
  ProviderQuote,
  ProviderRequest,
} from "./types.js";
import { providerFulfillment } from "./types.js";
import type { ProtocolHttpRequest } from "./x402.js";

export class MppProviderError extends Error {
  constructor(
    readonly code:
      | "MPP_EXPECTED_PAYMENT_REQUIRED"
      | "MPP_INVALID_CHALLENGE"
      | "MPP_UNSUPPORTED_PAYMENT"
      | "MPP_PAYMENT_FAILED"
      | "MPP_RECEIPT_MISSING"
      | "MPP_INVALID_RECEIPT",
    message: string,
  ) {
    super(message);
    this.name = "MppProviderError";
  }
}

type MppChallenge = {
  id: string;
  realm: string;
  method: string;
  intent: string;
  expires?: string;
  description?: string;
  opaque?: string;
  request: Record<string, unknown>;
};

type MppReceipt = {
  challengeId?: string;
  method?: string;
  type?: string;
  status?: string;
  reference?: string;
  timestamp?: string;
  network?: string;
  chainId?: number | string;
  externalId?: string;
  [key: string]: unknown;
};

export type MppProviderOptions<TInput, TOutput> = {
  metadata: Omit<ProviderMetadata, "protocol">;
  paidFetch: typeof globalThis.fetch;
  unpaidFetch?: typeof globalThis.fetch;
  buildRequest: (request: ProviderRequest<TInput>) => ProtocolHttpRequest;
  decodeResponse?: (response: Response) => Promise<TOutput>;
  acceptedMethods?: readonly string[];
  acceptedIntents?: readonly string[];
  sessionUnits?: (
    request: ProviderRequest<TInput>,
    challengeRequest: Record<string, unknown>,
  ) => bigint;
};

async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

async function defaultDecode<TOutput>(response: Response): Promise<TOutput> {
  return (await readBody(response)) as TOutput;
}

function decodeBase64UrlJson(value: string, label: string): Record<string, unknown> {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("decoded value is not an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new MppProviderError(
      label === "challenge" ? "MPP_INVALID_CHALLENGE" : "MPP_INVALID_RECEIPT",
      `failed to decode MPP ${label}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function splitAuthParams(input: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      parts.push(input.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts.filter(Boolean);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
  return trimmed
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

export function parseMppChallengeHeader(header: string): MppChallenge {
  const marker = /^Payment\s+/i;
  if (!marker.test(header)) {
    throw new MppProviderError(
      "MPP_INVALID_CHALLENGE",
      "WWW-Authenticate does not contain a Payment challenge",
    );
  }

  const rawParams = header.replace(marker, "");
  const params: Record<string, string> = {};
  for (const part of splitAuthParams(rawParams)) {
    const equals = part.indexOf("=");
    if (equals <= 0) continue;
    const key = part.slice(0, equals).trim();
    const value = unquote(part.slice(equals + 1));
    params[key] = value;
  }

  for (const required of ["id", "realm", "method", "intent", "request"] as const) {
    if (!params[required]) {
      throw new MppProviderError(
        "MPP_INVALID_CHALLENGE",
        `MPP challenge is missing ${required}`,
      );
    }
  }

  return {
    id: params.id!,
    realm: params.realm!,
    method: params.method!,
    intent: params.intent!,
    request: decodeBase64UrlJson(params.request!, "challenge"),
    ...(params.expires ? { expires: params.expires } : {}),
    ...(params.description ? { description: params.description } : {}),
    ...(params.opaque ? { opaque: params.opaque } : {}),
  };
}

function parseAtomic(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new MppProviderError(
      "MPP_INVALID_CHALLENGE",
      `MPP ${field} must be a stringified atomic integer`,
    );
  }
  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new MppProviderError(
      "MPP_INVALID_CHALLENGE",
      `MPP ${field} must be positive`,
    );
  }
  return parsed;
}

function requiredString(
  request: Record<string, unknown>,
  field: string,
): string {
  const value = request[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new MppProviderError(
      "MPP_INVALID_CHALLENGE",
      `MPP request is missing ${field}`,
    );
  }
  return value;
}

function decodeReceipt(response: Response): MppReceipt {
  const header = response.headers.get("Payment-Receipt");
  if (!header) {
    throw new MppProviderError(
      "MPP_RECEIPT_MISSING",
      "MPP paid response did not include Payment-Receipt",
    );
  }
  return decodeBase64UrlJson(header, "receipt") as MppReceipt;
}

function receiptMetadata(receipt: MppReceipt): Record<string, string> {
  if (receipt.status !== "success") {
    throw new MppProviderError(
      "MPP_PAYMENT_FAILED",
      `MPP receipt status is ${String(receipt.status ?? "missing")}`,
    );
  }

  const metadata: Record<string, string> = {
    "mpp.status": "success",
  };
  if (receipt.challengeId) metadata["mpp.challengeId"] = receipt.challengeId;
  if (receipt.method) metadata["mpp.method"] = receipt.method;
  if (receipt.type) metadata["mpp.type"] = receipt.type;
  if (receipt.reference) metadata["mpp.reference"] = receipt.reference;
  if (receipt.timestamp) metadata["mpp.timestamp"] = receipt.timestamp;
  if (receipt.network) metadata["mpp.network"] = receipt.network;
  if (receipt.chainId !== undefined) metadata["mpp.chainId"] = String(receipt.chainId);
  if (receipt.externalId) metadata["mpp.externalId"] = receipt.externalId;
  return metadata;
}

export class MppProviderAdapter<TInput = unknown, TOutput = unknown>
  implements ProviderAdapter<TInput, TOutput>
{
  readonly metadata: ProviderMetadata;
  private readonly unpaidFetch: typeof globalThis.fetch;
  private readonly acceptedMethods: readonly string[];
  private readonly acceptedIntents: readonly string[];

  constructor(private readonly options: MppProviderOptions<TInput, TOutput>) {
    this.metadata = { ...options.metadata, protocol: "mpp" };
    this.unpaidFetch = options.unpaidFetch ?? globalThis.fetch;
    this.acceptedMethods = options.acceptedMethods ?? ["tempo", "evm", "usdc"];
    this.acceptedIntents = options.acceptedIntents ?? ["session", "charge"];
  }

  async quote(request: ProviderRequest<TInput>): Promise<ProviderQuote> {
    const target = this.options.buildRequest(request);
    const response = await this.unpaidFetch(target.url, target.init);
    if (response.status !== 402) {
      throw new MppProviderError(
        "MPP_EXPECTED_PAYMENT_REQUIRED",
        `expected MPP resource to return 402, received ${response.status}`,
      );
    }

    const challengeHeader = response.headers.get("WWW-Authenticate");
    if (!challengeHeader) {
      throw new MppProviderError(
        "MPP_INVALID_CHALLENGE",
        "MPP 402 response is missing WWW-Authenticate",
      );
    }

    const challenge = parseMppChallengeHeader(challengeHeader);
    if (!this.acceptedMethods.includes(challenge.method)) {
      throw new MppProviderError(
        "MPP_UNSUPPORTED_PAYMENT",
        `unsupported MPP method: ${challenge.method}`,
      );
    }
    if (!this.acceptedIntents.includes(challenge.intent)) {
      throw new MppProviderError(
        "MPP_UNSUPPORTED_PAYMENT",
        `unsupported MPP intent: ${challenge.intent}`,
      );
    }

    const unitPriceAtomic = parseAtomic(challenge.request.amount, "amount");
    const currency = requiredString(challenge.request, "currency");
    const units =
      challenge.intent === "session"
        ? this.options.sessionUnits?.(request, challenge.request) ?? 1n
        : 1n;
    if (units <= 0n) {
      throw new MppProviderError(
        "MPP_INVALID_CHALLENGE",
        "MPP session units must be positive",
      );
    }
    const priceAtomic = unitPriceAtomic * units;

    return {
      providerId: this.metadata.id,
      requestId: request.requestId,
      mint: currency,
      priceAtomic,
      protocol: "mpp",
      protocolMetadata: {
        "mpp.challengeId": challenge.id,
        "mpp.realm": challenge.realm,
        "mpp.method": challenge.method,
        "mpp.intent": challenge.intent,
        "mpp.unitPriceAtomic": unitPriceAtomic.toString(),
        "mpp.unitsAuthorized": units.toString(),
        ...(typeof challenge.request.recipient === "string"
          ? { "mpp.recipient": challenge.request.recipient }
          : {}),
        ...(typeof challenge.request.unitType === "string"
          ? { "mpp.unitType": challenge.request.unitType }
          : {}),
        ...(typeof challenge.request.suggestedDeposit === "string"
          ? { "mpp.suggestedDeposit": challenge.request.suggestedDeposit }
          : {}),
        ...(challenge.expires ? { "mpp.expires": challenge.expires } : {}),
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
    if (!response.ok) {
      throw new MppProviderError(
        "MPP_PAYMENT_FAILED",
        `MPP paid request failed with HTTP ${response.status}`,
      );
    }

    const receipt = decodeReceipt(response);
    const protocolMetadata = receiptMetadata(receipt);
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
