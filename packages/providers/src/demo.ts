import type {
  PaymentAuthorization,
  ProviderAdapter,
  ProviderMetadata,
  ProviderQuote,
  ProviderRequest,
} from "./types.js";

const DEMO_MINT = "USDC";

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must not be empty`);
  }
  return normalized;
}

function assertAuthorized(
  metadata: ProviderMetadata,
  request: ProviderRequest,
  quote: ProviderQuote,
  authorization: PaymentAuthorization,
): void {
  if (
    quote.providerId !== metadata.id ||
    quote.requestId !== request.requestId ||
    authorization.providerId !== metadata.id ||
    authorization.requestId !== request.requestId ||
    authorization.amountAtomic !== quote.priceAtomic
  ) {
    throw new Error("invalid authorization for provider fulfillment");
  }
}

export type SearchInput = { query: string };
export type SearchOutput = {
  query: string;
  results: Array<{ rank: number; title: string; snippet: string }>;
};

export class DemoSearchProvider
  implements ProviderAdapter<SearchInput, SearchOutput>
{
  readonly metadata: ProviderMetadata = {
    id: "search",
    name: "Canalis Search",
    payee: "demo:search",
    protocol: "demo",
    description: "Deterministic search provider for the Canalis judge flow.",
  };

  async quote(request: ProviderRequest<SearchInput>): Promise<ProviderQuote> {
    requireText(request.input.query, "query");
    return {
      providerId: this.metadata.id,
      requestId: request.requestId,
      mint: DEMO_MINT,
      priceAtomic: 50_000n,
      protocol: this.metadata.protocol,
    };
  }

  async fulfillAuthorized(
    request: ProviderRequest<SearchInput>,
    quote: ProviderQuote,
    authorization: PaymentAuthorization,
  ): Promise<SearchOutput> {
    assertAuthorized(this.metadata, request, quote, authorization);
    const query = requireText(request.input.query, "query");

    return {
      query,
      results: [1, 2, 3].map((rank) => ({
        rank,
        title: `${query} — result ${rank}`,
        snippet: `Deterministic search evidence ${rank} for ${query}.`,
      })),
    };
  }
}

export type DataInput = { key: string };
export type DataOutput = {
  key: string;
  value: number;
  unit: string;
  source: string;
};

export class DemoDataProvider implements ProviderAdapter<DataInput, DataOutput> {
  readonly metadata: ProviderMetadata = {
    id: "data",
    name: "Canalis Data",
    payee: "demo:data",
    protocol: "demo",
    description: "Deterministic structured-data lookup for the Canalis judge flow.",
  };

  async quote(request: ProviderRequest<DataInput>): Promise<ProviderQuote> {
    requireText(request.input.key, "key");
    return {
      providerId: this.metadata.id,
      requestId: request.requestId,
      mint: DEMO_MINT,
      priceAtomic: 30_000n,
      protocol: this.metadata.protocol,
    };
  }

  async fulfillAuthorized(
    request: ProviderRequest<DataInput>,
    quote: ProviderQuote,
    authorization: PaymentAuthorization,
  ): Promise<DataOutput> {
    assertAuthorized(this.metadata, request, quote, authorization);
    const key = requireText(request.input.key, "key");
    const value = [...key].reduce((sum, char) => sum + char.codePointAt(0)!, 0) % 10_000;

    return {
      key,
      value,
      unit: "index-points",
      source: "canalis-demo-dataset",
    };
  }
}

export type InferenceInput = { prompt: string };
export type InferenceOutput = {
  completion: string;
  inputCharacters: number;
  model: string;
};

export class DemoInferenceProvider
  implements ProviderAdapter<InferenceInput, InferenceOutput>
{
  readonly metadata: ProviderMetadata = {
    id: "inference",
    name: "Canalis Inference",
    payee: "demo:inference",
    protocol: "demo",
    description: "Deterministic inference-style provider for the Canalis judge flow.",
  };

  async quote(request: ProviderRequest<InferenceInput>): Promise<ProviderQuote> {
    requireText(request.input.prompt, "prompt");
    return {
      providerId: this.metadata.id,
      requestId: request.requestId,
      mint: DEMO_MINT,
      priceAtomic: 120_000n,
      protocol: this.metadata.protocol,
    };
  }

  async fulfillAuthorized(
    request: ProviderRequest<InferenceInput>,
    quote: ProviderQuote,
    authorization: PaymentAuthorization,
  ): Promise<InferenceOutput> {
    assertAuthorized(this.metadata, request, quote, authorization);
    const prompt = requireText(request.input.prompt, "prompt");

    return {
      completion: `Canalis synthesized response for: ${prompt}`,
      inputCharacters: prompt.length,
      model: "canalis-demo-1",
    };
  }
}

export const demoProviders = {
  search: new DemoSearchProvider(),
  data: new DemoDataProvider(),
  inference: new DemoInferenceProvider(),
} as const;
