import type {
  RouteFlow,
  RouteSettlementRecord,
  Task,
  TaskPaymentGraph,
  TaskStatus,
} from "@canalis/core";
import type { ProviderMetadata } from "@canalis/providers";
import type {
  JsonObject,
  ProviderHealthStatus,
  ProviderMode,
} from "./contracts.js";

export type PersistedTask = Task & {
  mode: ProviderMode;
  updatedAtUnixSeconds: bigint;
};

export type ProviderUsage = {
  tasks: number;
  channels: number;
  flows: number;
};

export type PersistedProvider = ProviderMetadata & {
  mode: ProviderMode;
  endpoint?: string;
  enabled: boolean;
  supportedAssets: string[];
  supportedNetworks: string[];
  pricingModel: JsonObject;
  defaultChannelCeilingAtomic?: bigint;
  healthStatus: ProviderHealthStatus;
  healthMessage?: string;
  lastHealthAt?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  hasSecrets: boolean;
  secretKeys: string[];
  usage: ProviderUsage;
};

export type ProviderRecordInput = {
  id: string;
  name: string;
  payee: string;
  protocol: ProviderMetadata["protocol"];
  mode: ProviderMode;
  description: string;
  endpoint?: string;
  enabled: boolean;
  supportedAssets: string[];
  supportedNetworks: string[];
  pricingModel: JsonObject;
  defaultChannelCeilingAtomic?: bigint;
};

export type ProviderHealthUpdate = {
  status: ProviderHealthStatus;
  message: string;
  checkedAt: string;
  successAt?: string;
  errorAt?: string;
  error?: string;
};

export type ChannelStatus =
  | "reserved"
  | "open"
  | "sealed"
  | "distributed"
  | "recovered"
  | "failed";

export type PersistedChannel = {
  taskId: string;
  providerId: string;
  programAddress: string;
  network: string;
  channelAddress?: string;
  ceilingAtomic: bigint;
  cumulativeAuthorizedAtomic: bigint;
  spentAtomic: bigint;
  status: ChannelStatus;
  openTransactionSignature?: string;
  settleTransactionSignature?: string;
  distributionTransactionSignature?: string;
  refundTransactionSignature?: string;
  recoveryState?: JsonObject;
  createdAtUnixSeconds: bigint;
  updatedAtUnixSeconds: bigint;
};

export type ChannelUpdate = Partial<
  Pick<
    PersistedChannel,
    | "channelAddress"
    | "cumulativeAuthorizedAtomic"
    | "spentAtomic"
    | "status"
    | "openTransactionSignature"
    | "settleTransactionSignature"
    | "distributionTransactionSignature"
    | "refundTransactionSignature"
    | "recoveryState"
  >
>;

export interface CanalisRepository {
  createTask(task: PersistedTask, channels: readonly PersistedChannel[]): Promise<void>;
  getTask(taskId: string): Promise<PersistedTask | null>;
  listTasks(limit?: number): Promise<PersistedTask[]>;
  getChannels(taskId: string): Promise<PersistedChannel[]>;
  getFlows(taskId: string): Promise<RouteFlow[]>;
  getSettlements(taskId: string): Promise<RouteSettlementRecord[]>;

  listProviders(): Promise<PersistedProvider[]>;
  getProvider(providerId: string): Promise<PersistedProvider | null>;
  createProvider(
    provider: ProviderRecordInput,
    secretHeaders?: Record<string, string>,
  ): Promise<void>;
  updateProvider(
    providerId: string,
    provider: Omit<ProviderRecordInput, "id">,
    options?: {
      secretHeaders?: Record<string, string>;
      clearSecrets?: boolean;
    },
  ): Promise<void>;
  getProviderSecretHeaders(providerId: string): Promise<Record<string, string>>;
  recordProviderHealth(providerId: string, update: ProviderHealthUpdate): Promise<void>;

  saveExecution(
    taskId: string,
    graph: TaskPaymentGraph,
    status: TaskStatus,
    updatedAtUnixSeconds: bigint,
  ): Promise<void>;
  updateChannel(
    taskId: string,
    providerId: string,
    update: ChannelUpdate,
    updatedAtUnixSeconds: bigint,
  ): Promise<void>;
  close?(): Promise<void>;
}
