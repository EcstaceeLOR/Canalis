import {
  CANALIS_DEVNET_SANDBOX_MINT,
  SOLANA_DEVNET_CAIP2,
} from "@canalis/solana";
import {
  createProviderRequestSchema,
  providerPricingSchema,
  updateProviderRequestSchema,
  type CreateProviderRequest,
  type ProviderDto,
  type ProviderMode,
  type UpdateProviderRequest,
} from "./contracts.js";
import { ApplicationError } from "./errors.js";
import type {
  CanalisRepository,
  PersistedProvider,
  ProviderRecordInput,
} from "./repository.js";

function validationError(message: string, details?: unknown): ApplicationError {
  return new ApplicationError("VALIDATION_ERROR", message, 400, details);
}

function providerDto(provider: PersistedProvider): ProviderDto {
  return {
    id: provider.id,
    name: provider.name,
    payee: provider.payee,
    protocol: provider.protocol,
    mode: provider.mode,
    description: provider.description,
    ...(provider.endpoint ? { endpoint: provider.endpoint } : {}),
    enabled: provider.enabled,
    supportedAssets: [...provider.supportedAssets],
    supportedNetworks: [...provider.supportedNetworks],
    pricingModel: providerPricingSchema.parse(provider.pricingModel),
    ...(provider.defaultChannelCeilingAtomic !== undefined
      ? { defaultChannelCeilingAtomic: provider.defaultChannelCeilingAtomic.toString() }
      : {}),
    health: {
      status: provider.healthStatus,
      ...(provider.healthMessage ? { message: provider.healthMessage } : {}),
      ...(provider.lastHealthAt ? { lastCheckedAt: provider.lastHealthAt } : {}),
      ...(provider.lastSuccessAt ? { lastSuccessAt: provider.lastSuccessAt } : {}),
      ...(provider.lastErrorAt ? { lastErrorAt: provider.lastErrorAt } : {}),
      ...(provider.lastError ? { lastError: provider.lastError } : {}),
    },
    secrets: {
      configured: provider.hasSecrets,
      keys: [...provider.secretKeys],
    },
    usage: { ...provider.usage },
  };
}

function recordInput(input: zOutputCreateProvider): ProviderRecordInput {
  return {
    id: input.id,
    name: input.name,
    payee: input.payee,
    protocol: input.protocol,
    mode: input.mode,
    description: input.description,
    ...(input.endpoint ? { endpoint: input.endpoint } : {}),
    enabled: input.enabled,
    supportedAssets: [...input.supportedAssets],
    supportedNetworks: [...input.supportedNetworks],
    pricingModel: { ...input.pricingModel },
    ...(input.defaultChannelCeilingAtomic
      ? { defaultChannelCeilingAtomic: BigInt(input.defaultChannelCeilingAtomic) }
      : {}),
  };
}

type zOutputCreateProvider = ReturnType<typeof createProviderRequestSchema.parse>;

function normalizeUpdate(
  current: PersistedProvider,
  input: UpdateProviderRequest,
): zOutputCreateProvider {
  const parsed = updateProviderRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError("Provider update validation failed.", parsed.error.flatten());
  }
  const data = parsed.data;
  const candidate = {
    id: current.id,
    name: data.name ?? current.name,
    payee: data.payee ?? current.payee,
    protocol: data.protocol ?? current.protocol,
    mode: data.mode ?? current.mode,
    description: data.description ?? current.description,
    endpoint:
      data.endpoint === null
        ? undefined
        : data.endpoint ?? current.endpoint,
    enabled: data.enabled ?? current.enabled,
    supportedAssets: data.supportedAssets ?? current.supportedAssets,
    supportedNetworks: data.supportedNetworks ?? current.supportedNetworks,
    pricingModel: data.pricingModel ?? providerPricingSchema.parse(current.pricingModel),
    defaultChannelCeilingAtomic:
      data.defaultChannelCeilingAtomic === null
        ? undefined
        : data.defaultChannelCeilingAtomic ?? current.defaultChannelCeilingAtomic?.toString(),
    ...(data.secretHeaders ? { secretHeaders: data.secretHeaders } : {}),
  };
  const validated = createProviderRequestSchema.safeParse(candidate);
  if (!validated.success) {
    throw validationError("Provider update validation failed.", validated.error.flatten());
  }
  return validated.data;
}

export class ProviderRegistry {
  constructor(
    private readonly repository: CanalisRepository,
    private readonly fetcher: typeof globalThis.fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<ProviderDto[]> {
    return (await this.repository.listProviders()).map(providerDto);
  }

  async get(providerId: string): Promise<ProviderDto> {
    return providerDto(await this.requireProvider(providerId));
  }

  async create(input: CreateProviderRequest | unknown): Promise<ProviderDto> {
    const parsed = createProviderRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw validationError("Provider configuration validation failed.", parsed.error.flatten());
    }
    if (await this.repository.getProvider(parsed.data.id)) {
      throw new ApplicationError("PROVIDER_ALREADY_EXISTS", "A provider with this id already exists.", 409);
    }

    await this.repository.createProvider(
      recordInput(parsed.data),
      parsed.data.secretHeaders,
    );

    if (parsed.data.protocol === "demo") {
      const checkedAt = this.now().toISOString();
      await this.repository.recordProviderHealth(parsed.data.id, {
        status: "healthy",
        message: "Deterministic provider is available locally.",
        checkedAt,
        successAt: checkedAt,
      });
    }
    return this.get(parsed.data.id);
  }

  async update(providerId: string, input: UpdateProviderRequest | unknown): Promise<ProviderDto> {
    const current = await this.requireProvider(providerId);
    const parsedUpdate = updateProviderRequestSchema.safeParse(input);
    if (!parsedUpdate.success) {
      throw validationError("Provider update validation failed.", parsedUpdate.error.flatten());
    }
    const merged = normalizeUpdate(current, parsedUpdate.data);
    const next = recordInput(merged);
    const { id: _id, ...withoutId } = next;
    await this.repository.updateProvider(providerId, withoutId, {
      ...(parsedUpdate.data.secretHeaders
        ? { secretHeaders: parsedUpdate.data.secretHeaders }
        : {}),
      ...(parsedUpdate.data.clearSecrets ? { clearSecrets: true } : {}),
    });
    return this.get(providerId);
  }

  async checkHealth(providerId: string): Promise<ProviderDto> {
    const provider = await this.requireProvider(providerId);
    const checkedAt = this.now().toISOString();

    if (provider.protocol === "demo") {
      await this.repository.recordProviderHealth(provider.id, {
        status: "healthy",
        message: "Deterministic provider is available locally.",
        checkedAt,
        successAt: checkedAt,
      });
      return this.get(provider.id);
    }

    if (!provider.endpoint) {
      await this.repository.recordProviderHealth(provider.id, {
        status: "unhealthy",
        message: "Provider has no configured endpoint.",
        checkedAt,
        errorAt: checkedAt,
        error: "Missing endpoint",
      });
      return this.get(provider.id);
    }

    try {
      const secretHeaders = await this.repository.getProviderSecretHeaders(provider.id);
      const response = await this.fetcher(provider.endpoint, {
        method: "GET",
        headers: {
          accept: "application/json, text/plain;q=0.9, */*;q=0.8",
          ...secretHeaders,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });
      const acceptable =
        response.status === 402 ||
        (response.status >= 200 && response.status < 400);
      if (!acceptable) {
        throw new Error(`Endpoint returned HTTP ${response.status}.`);
      }
      const challenge = response.status === 402 ? " Payment challenge observed." : "";
      await this.repository.recordProviderHealth(provider.id, {
        status: "healthy",
        message: `Endpoint reachable (HTTP ${response.status}).${challenge}`,
        checkedAt,
        successAt: checkedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider health check failed.";
      await this.repository.recordProviderHealth(provider.id, {
        status: "unhealthy",
        message,
        checkedAt,
        errorAt: checkedAt,
        error: message,
      });
    }
    return this.get(provider.id);
  }

  async validateTaskSelection(
    providerIds: readonly string[],
    mode: "deterministic" | "x402",
  ): Promise<void> {
    const unique = [...new Set(providerIds)];
    if (unique.length === 0) throw validationError("Select at least one provider.");

    for (const providerId of unique) {
      const provider = await this.repository.getProvider(providerId);
      if (!provider) {
        throw new ApplicationError(
          "PROVIDER_NOT_FOUND",
          `Provider ${providerId} is not registered.`,
          400,
        );
      }
      if (!provider.enabled) {
        throw new ApplicationError(
          "PROVIDER_DISABLED",
          `Provider ${provider.name} is disabled.`,
          409,
        );
      }
      if (provider.healthStatus === "unhealthy") {
        throw new ApplicationError(
          "PROVIDER_UNHEALTHY",
          `Provider ${provider.name} is unhealthy: ${provider.lastError ?? provider.healthMessage ?? "health check failed"}`,
          409,
        );
      }

      const expectedMode: ProviderMode = mode === "deterministic" ? "deterministic" : "x402";
      if (provider.mode !== expectedMode) {
        throw new ApplicationError(
          "PROVIDER_MODE_MISMATCH",
          `Provider ${provider.name} uses ${provider.mode} mode and cannot be used by a ${mode} task.`,
          400,
        );
      }

      if (mode === "x402") {
        if (provider.healthStatus !== "healthy") {
          throw new ApplicationError(
            "PROVIDER_HEALTH_REQUIRED",
            `Run a successful health check for ${provider.name} before using it in a live task.`,
            409,
          );
        }
        if (!provider.supportedNetworks.includes(SOLANA_DEVNET_CAIP2)) {
          throw new ApplicationError(
            "PROVIDER_NETWORK_UNSUPPORTED",
            `${provider.name} does not support the Canalis Solana devnet network.`,
            400,
          );
        }
        if (
          !provider.supportedAssets.includes(CANALIS_DEVNET_SANDBOX_MINT) &&
          !provider.supportedAssets.includes("USDC")
        ) {
          throw new ApplicationError(
            "PROVIDER_ASSET_UNSUPPORTED",
            `${provider.name} does not support the Canalis devnet task asset.`,
            400,
          );
        }
      }
    }
  }

  private async requireProvider(providerId: string): Promise<PersistedProvider> {
    const normalized = providerId.trim();
    if (!normalized) throw validationError("Provider id is required.");
    const provider = await this.repository.getProvider(normalized);
    if (!provider) throw new ApplicationError("PROVIDER_NOT_FOUND", "Provider not found.", 404);
    return provider;
  }
}
