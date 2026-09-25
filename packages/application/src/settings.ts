import { z } from "zod";
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2 } from "@canalis/solana";
import { ApplicationError } from "./errors.js";
import type { ProviderMode } from "./contracts.js";

export const productEnvironments = ["local", "devnet", "mainnet"] as const;
export type ProductEnvironment = (typeof productEnvironments)[number];

export const solanaNetworks = ["localnet", "devnet", "mainnet-beta"] as const;
export type SolanaNetwork = (typeof solanaNetworks)[number];

export const explorerClusters = ["localnet", "devnet", "mainnet-beta"] as const;
export type ExplorerCluster = (typeof explorerClusters)[number];

export type AccountSettings = {
  ownerWallet: string;
  displayName: string;
  environment: ProductEnvironment;
  solanaNetwork: SolanaNetwork;
  defaultAssetSymbol: string;
  defaultAssetMint?: string;
  explorerCluster: ExplorerCluster;
  taskDefaults: {
    agentId: string;
    executionMode: ProviderMode;
    defaultPolicyId?: string;
    saveAsDraft: boolean;
  };
  notifications: {
    taskFailures: boolean;
    providerIncidents: boolean;
    settlementFailures: boolean;
    recoveryRequired: boolean;
  };
  product: {
    autoRefreshSeconds: number;
    compactTables: boolean;
    showAdvancedMetadata: boolean;
  };
  mainnetAcknowledged: boolean;
  updatedAtUnixSeconds?: string;
};

const publicKeySchema = z
  .string()
  .trim()
  .min(32)
  .max(64)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, "Use a valid base58 Solana mint address.");

const settingsInputSchema = z.object({
  displayName: z.string().trim().max(120).default(""),
  environment: z.enum(productEnvironments),
  solanaNetwork: z.enum(solanaNetworks),
  defaultAssetSymbol: z.string().trim().min(2).max(24).transform((value) => value.toUpperCase()),
  defaultAssetMint: z.union([publicKeySchema, z.literal(""), z.null()]).optional(),
  explorerCluster: z.enum(explorerClusters),
  taskDefaults: z.object({
    agentId: z.string().trim().min(1).max(128),
    executionMode: z.enum(["deterministic", "x402", "mpp"]),
    defaultPolicyId: z.union([z.string().trim().min(1).max(120), z.literal(""), z.null()]).optional(),
    saveAsDraft: z.boolean(),
  }).strict(),
  notifications: z.object({
    taskFailures: z.boolean(),
    providerIncidents: z.boolean(),
    settlementFailures: z.boolean(),
    recoveryRequired: z.boolean(),
  }).strict(),
  product: z.object({
    autoRefreshSeconds: z.coerce.number().int().min(0).max(300),
    compactTables: z.boolean(),
    showAdvancedMetadata: z.boolean(),
  }).strict(),
  mainnetAcknowledged: z.boolean().default(false),
}).strict();

export type AccountSettingsInput = z.input<typeof settingsInputSchema>;

const expectedNetwork: Record<ProductEnvironment, SolanaNetwork> = {
  local: "localnet",
  devnet: "devnet",
  mainnet: "mainnet-beta",
};

export function defaultAccountSettings(ownerWallet: string): AccountSettings {
  return {
    ownerWallet,
    displayName: "",
    environment: "devnet",
    solanaNetwork: "devnet",
    defaultAssetSymbol: "USDC",
    explorerCluster: "devnet",
    taskDefaults: {
      agentId: "canalis-agent",
      executionMode: "deterministic",
      saveAsDraft: false,
    },
    notifications: {
      taskFailures: true,
      providerIncidents: true,
      settlementFailures: true,
      recoveryRequired: true,
    },
    product: {
      autoRefreshSeconds: 30,
      compactTables: false,
      showAdvancedMetadata: false,
    },
    mainnetAcknowledged: false,
  };
}

export function parseAccountSettings(input: unknown, ownerWallet: string): AccountSettings {
  const parsed = settingsInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Settings validation failed.",
      400,
      parsed.error.flatten(),
    );
  }

  const value = parsed.data;
  const requiredNetwork = expectedNetwork[value.environment];
  if (value.solanaNetwork !== requiredNetwork) {
    throw new ApplicationError(
      "SETTINGS_ENVIRONMENT_NETWORK_MISMATCH",
      `${value.environment} must use ${requiredNetwork}. Change the environment and Solana network together.`,
      400,
    );
  }
  if (value.explorerCluster !== value.solanaNetwork) {
    throw new ApplicationError(
      "SETTINGS_EXPLORER_NETWORK_MISMATCH",
      "Explorer cluster must match the active Solana network.",
      400,
    );
  }
  if (value.product.autoRefreshSeconds > 0 && value.product.autoRefreshSeconds < 5) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Auto-refresh must be disabled or at least 5 seconds.",
      400,
    );
  }

  const defaultAssetMint = typeof value.defaultAssetMint === "string" && value.defaultAssetMint.trim()
    ? value.defaultAssetMint.trim()
    : undefined;
  const defaultPolicyId = typeof value.taskDefaults.defaultPolicyId === "string" && value.taskDefaults.defaultPolicyId.trim()
    ? value.taskDefaults.defaultPolicyId.trim()
    : undefined;

  if (value.environment === "mainnet") {
    if (!value.mainnetAcknowledged) {
      throw new ApplicationError(
        "MAINNET_ACKNOWLEDGEMENT_REQUIRED",
        "Mainnet must be explicitly acknowledged before it can be enabled.",
        400,
      );
    }
    if (!defaultAssetMint) {
      throw new ApplicationError(
        "MAINNET_ASSET_MINT_REQUIRED",
        "Mainnet requires an explicit token mint. Symbol-only defaults are not allowed.",
        400,
      );
    }
    if (value.taskDefaults.executionMode === "deterministic") {
      throw new ApplicationError(
        "MAINNET_DEMO_MODE_BLOCKED",
        "Deterministic demo execution cannot be the default in a mainnet workspace.",
        400,
      );
    }
  }

  return {
    ownerWallet,
    displayName: value.displayName,
    environment: value.environment,
    solanaNetwork: value.solanaNetwork,
    defaultAssetSymbol: value.defaultAssetSymbol,
    ...(defaultAssetMint ? { defaultAssetMint } : {}),
    explorerCluster: value.explorerCluster,
    taskDefaults: {
      agentId: value.taskDefaults.agentId,
      executionMode: value.taskDefaults.executionMode,
      ...(defaultPolicyId ? { defaultPolicyId } : {}),
      saveAsDraft: value.taskDefaults.saveAsDraft,
    },
    notifications: value.notifications,
    product: value.product,
    mainnetAcknowledged: value.mainnetAcknowledged,
  };
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

export function networkMatches(active: SolanaNetwork, candidate: string): boolean {
  const value = normalized(candidate);
  if (active === "devnet") {
    return value === normalized(SOLANA_DEVNET_CAIP2) || value === "devnet" || value.includes("devnet");
  }
  if (active === "mainnet-beta") {
    return value === normalized(SOLANA_MAINNET_CAIP2) || value === "mainnet" || value === "mainnet-beta" || value.includes("mainnet");
  }
  return value === "localnet" || value === "local" || value.includes("local");
}

export function assetMatches(settings: Pick<AccountSettings, "defaultAssetSymbol" | "defaultAssetMint">, candidate: string): boolean {
  const value = candidate.trim();
  if (value.toUpperCase() === settings.defaultAssetSymbol.toUpperCase()) return true;
  return Boolean(settings.defaultAssetMint && value === settings.defaultAssetMint);
}

export function assertIntegrationCompatible(
  settings: AccountSettings,
  integration: {
    protocol: "demo" | "x402" | "mpp";
    endpoint?: string;
    supportedNetworks: readonly string[];
    supportedAssets: readonly string[];
  },
): void {
  if (settings.environment === "mainnet" && integration.protocol === "demo") {
    throw new ApplicationError(
      "MAINNET_DEMO_PROVIDER_BLOCKED",
      "Demo providers cannot be enabled in a mainnet workspace.",
      409,
    );
  }
  if (integration.protocol !== "demo" && !integration.supportedNetworks.some((value) => networkMatches(settings.solanaNetwork, value))) {
    throw new ApplicationError(
      "INTEGRATION_NETWORK_MISMATCH",
      `Integration must explicitly support the active ${settings.solanaNetwork} network.`,
      409,
    );
  }
  if (integration.protocol !== "demo" && !integration.supportedAssets.some((value) => assetMatches(settings, value))) {
    const expected = settings.defaultAssetMint
      ? `${settings.defaultAssetSymbol} (${settings.defaultAssetMint})`
      : settings.defaultAssetSymbol;
    throw new ApplicationError(
      "INTEGRATION_ASSET_MISMATCH",
      `Integration must explicitly support the workspace default asset ${expected}.`,
      409,
    );
  }
  if (settings.environment === "mainnet" && integration.endpoint) {
    const endpoint = new URL(integration.endpoint);
    if (endpoint.protocol !== "https:") {
      throw new ApplicationError(
        "MAINNET_ENDPOINT_INSECURE",
        "Mainnet integrations must use HTTPS endpoints.",
        409,
      );
    }
  }
}

export function assertTaskCompatibleWithSettings(
  settings: AccountSettings,
  task: {
    mode: ProviderMode;
    allowedNetworks: readonly string[];
    allowedMints: readonly string[];
    allowedProtocols: readonly string[];
  },
): void {
  if (settings.environment === "mainnet" && task.mode === "deterministic") {
    throw new ApplicationError(
      "MAINNET_DEMO_MODE_BLOCKED",
      "Deterministic demo tasks are disabled in a mainnet workspace.",
      409,
    );
  }
  if (task.allowedNetworks.length > 0 && !task.allowedNetworks.some((value) => networkMatches(settings.solanaNetwork, value))) {
    throw new ApplicationError(
      "TASK_NETWORK_MISMATCH",
      `Task policy does not allow the active ${settings.solanaNetwork} network.`,
      409,
    );
  }
  if (task.allowedMints.length > 0 && !task.allowedMints.some((value) => assetMatches(settings, value))) {
    throw new ApplicationError(
      "TASK_ASSET_MISMATCH",
      `Task policy does not allow the workspace default asset ${settings.defaultAssetSymbol}.`,
      409,
    );
  }
  if (settings.environment === "mainnet" && task.allowedProtocols.includes("demo")) {
    throw new ApplicationError(
      "MAINNET_DEMO_PROVIDER_BLOCKED",
      "Mainnet task policies cannot include the demo protocol.",
      409,
    );
  }
}
