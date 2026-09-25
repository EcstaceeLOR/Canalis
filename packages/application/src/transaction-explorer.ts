import type { JsonObject } from "./contracts.js";

export const transactionEventTypes = [
  "authorization",
  "receipt",
  "channel_open",
  "settlement",
  "distribution",
  "recovery",
  "failure",
] as const;
export type TransactionEventType = (typeof transactionEventTypes)[number];

export const transactionLayers = ["offchain", "onchain"] as const;
export type TransactionLayer = (typeof transactionLayers)[number];

export const transactionSorts = ["newest", "oldest", "amount_desc", "amount_asc"] as const;
export type TransactionSort = (typeof transactionSorts)[number];

export type TransactionExplorerQuery = {
  owner: string;
  search?: string;
  taskId?: string;
  providerId?: string;
  protocol?: string;
  status?: string;
  network?: string;
  eventType?: TransactionEventType;
  layer?: TransactionLayer;
  createdFromUnixSeconds?: bigint;
  createdToUnixSeconds?: bigint;
  sort: TransactionSort;
  page: number;
  pageSize: number;
};

export type TransactionExplorerRecord = {
  id: string;
  taskId: string;
  taskName: string;
  providerId: string;
  providerName: string;
  eventType: TransactionEventType;
  layer: TransactionLayer;
  status: string;
  protocol: string;
  network: string;
  mint: string;
  amountAtomic: string;
  cumulativeAtomic?: string;
  authorizedDeltaAtomic: string;
  settledDeltaAtomic: string;
  recoveredAtomic: string;
  channelAddress?: string;
  receiptHash?: string;
  signature?: string;
  requestId?: string;
  authorizationId?: string;
  paymentReference?: string;
  sourceFlowId?: string;
  metadata: JsonObject;
  createdAtUnixSeconds: string;
};

export type TransactionExplorerSummary = {
  totalEvents: number;
  offchainEvents: number;
  onchainEvents: number;
  failedEvents: number;
  authorizedAtomic: string;
  settledAtomic: string;
  recoveredAtomic: string;
};

export type TransactionExplorerResult = {
  events: TransactionExplorerRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: TransactionExplorerSummary;
};

function parseUnix(value: string | null): bigint | undefined {
  if (!value) return undefined;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parseTransactionExplorerQuery(url: URL, owner: string): TransactionExplorerQuery {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));
  const search = url.searchParams.get("q")?.trim().slice(0, 160) || undefined;
  const taskId = url.searchParams.get("task")?.trim().slice(0, 160) || undefined;
  const providerId = url.searchParams.get("provider")?.trim().slice(0, 80) || undefined;
  const protocol = url.searchParams.get("protocol")?.trim().slice(0, 40) || undefined;
  const status = url.searchParams.get("status")?.trim().slice(0, 80) || undefined;
  const network = url.searchParams.get("network")?.trim().slice(0, 160) || undefined;
  const typeRaw = url.searchParams.get("type");
  const layerRaw = url.searchParams.get("layer");
  const sortRaw = url.searchParams.get("sort") ?? "newest";
  const eventType = transactionEventTypes.includes(typeRaw as TransactionEventType)
    ? (typeRaw as TransactionEventType)
    : undefined;
  const layer = transactionLayers.includes(layerRaw as TransactionLayer)
    ? (layerRaw as TransactionLayer)
    : undefined;
  const sort = transactionSorts.includes(sortRaw as TransactionSort)
    ? (sortRaw as TransactionSort)
    : "newest";
  const createdFromUnixSeconds = parseUnix(url.searchParams.get("from"));
  const createdToUnixSeconds = parseUnix(url.searchParams.get("to"));

  return {
    owner,
    ...(search ? { search } : {}),
    ...(taskId ? { taskId } : {}),
    ...(providerId ? { providerId } : {}),
    ...(protocol ? { protocol } : {}),
    ...(status ? { status } : {}),
    ...(network ? { network } : {}),
    ...(eventType ? { eventType } : {}),
    ...(layer ? { layer } : {}),
    ...(createdFromUnixSeconds !== undefined ? { createdFromUnixSeconds } : {}),
    ...(createdToUnixSeconds !== undefined ? { createdToUnixSeconds } : {}),
    sort,
    page,
    pageSize,
  };
}
