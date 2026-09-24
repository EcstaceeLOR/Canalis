export type ProviderProtocol = "demo" | "x402" | "mpp";

export type ProviderMetadata = {
  id: string;
  name: string;
  payee: string;
  protocol: ProviderProtocol;
  description: string;
};

export type ProviderRequest<TInput = unknown> = {
  requestId: string;
  input: TInput;
};

export type ProviderQuote = {
  providerId: string;
  requestId: string;
  mint: string;
  priceAtomic: bigint;
  protocol: ProviderProtocol;
};

export type PaymentAuthorization = {
  authorizationId: string;
  providerId: string;
  requestId: string;
  mint: string;
  amountAtomic: bigint;
  protocol: ProviderProtocol;
  paymentReference?: string;
};

export type ProviderReceipt = {
  providerId: string;
  requestId: string;
  mint: string;
  priceAtomic: bigint;
  protocol: ProviderProtocol;
  authorizationId: string;
  paymentReference?: string;
  responseHash: string;
  timestampUnixSeconds: bigint;
};

export type ProviderResult<TOutput = unknown> = {
  output: TOutput;
  receipt: ProviderReceipt;
};

export type PaymentAuthorizer = {
  authorize(quote: ProviderQuote): Promise<PaymentAuthorization>;
};

export interface ProviderAdapter<TInput = unknown, TOutput = unknown> {
  readonly metadata: ProviderMetadata;
  quote(request: ProviderRequest<TInput>): Promise<ProviderQuote>;
  fulfillAuthorized(
    request: ProviderRequest<TInput>,
    quote: ProviderQuote,
    authorization: PaymentAuthorization,
  ): Promise<TOutput>;
}

export type ExecuteProviderOptions = {
  nowUnixSeconds?: () => bigint;
};
