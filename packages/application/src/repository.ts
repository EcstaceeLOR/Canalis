import type {
  RouteFlow,
  RouteSettlementRecord,
  Task,
  TaskPaymentGraph,
  TaskStatus,
} from "@canalis/core";
import type { ProviderMetadata } from "@canalis/providers";
import type { JsonObject, ProviderMode } from "./contracts.js";

export type PersistedTask = Task & {
  mode: ProviderMode;
  updatedAtUnixSeconds: bigint;
};

export type PersistedProvider = ProviderMetadata & {
  mode: ProviderMode;
  endpoint?: string;
  config?: JsonObject;
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
