import { z } from "zod";
import { ApplicationError } from "./errors.js";
import type { JsonObject } from "./contracts.js";

export const transactionKinds = [
  "authorization",
  "rejection",
  "failure",
  "channel_open",
  "settlement",
  "distribution",
  "recovery",
] as const;
export type TransactionKind = (typeof transactionKinds)[number];

export const transactionPlanes = ["offchain", "onchain"] as const;
export type TransactionPlane = (typeof transactionPlanes)[number];

export type TransactionRecord = {
  id: string;
  kind: TransactionKind;
  plane: TransactionPlane;
  status: string;
  taskId: string;
  taskName: string;
  providerId: string;
  providerName: string;
  protocol: string;
  network?: string;
  mint?: string;
  amountAtomic: string;
  previousCumulativeAtomic?: string;
  cumulativeAtomic?: string;
  requestId?: string;
  authorizationId?: string;
  paymentReference?: string;
  responseHash?: string;
  channelAddress?: string;
  signature?: string;
  timestampUnixSeconds: string;
  rawMetadata: JsonObject;
};

export type TransactionSummary = {
  authorizationCount: number;
  authorizationAtomic: string;
  settledAtomic: string;
  recoveredAtomic: string;
  failedCount: number;
  onchainCount: number;
};

export type TransactionListResult = {
  records: TransactionRecord[];
  summary: TransactionSummary;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type TransactionListQuery = {
  owner: string;
  search?: string;
  taskId?: string;
  providerId?: string;
  protocol?: string;
  network?: string;
  statuses?: string[];
  kinds?: TransactionKind[];
  fromUnixSeconds?: bigint;
  toUnixSeconds?: bigint;
  page: number;
  pageSize: number;
  sort: "newest" | "oldest" | "amount_desc";
};

const exportFormatSchema = z.enum(["json", "csv"]);
export type TransactionExportFormat = z.infer<typeof exportFormatSchema>;

function parseUnix(value: string | null): bigint | undefined {
  if (!value) return undefined;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parseTransactionListQuery(url: URL, owner: string): TransactionListQuery {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));
  const kinds = (url.searchParams.get("kind") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is TransactionKind => (transactionKinds as readonly string[]).includes(value));
  const statuses = (url.searchParams.get("status") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 12);
  const sortRaw = url.searchParams.get("sort");
  const sort = sortRaw === "oldest" || sortRaw === "amount_desc" ? sortRaw : "newest";
  const search = url.searchParams.get("q")?.trim().slice(0, 160) || undefined;
  const taskId = url.searchParams.get("task")?.trim() || undefined;
  const providerId = url.searchParams.get("provider")?.trim() || undefined;
  const protocol = url.searchParams.get("protocol")?.trim() || undefined;
  const network = url.searchParams.get("network")?.trim() || undefined;
  return {
    owner,
    ...(search ? { search } : {}),
    ...(taskId ? { taskId } : {}),
    ...(providerId ? { providerId } : {}),
    ...(protocol ? { protocol } : {}),
    ...(network ? { network } : {}),
    ...(statuses.length ? { statuses } : {}),
    ...(kinds.length ? { kinds } : {}),
    ...(parseUnix(url.searchParams.get("from")) !== undefined ? { fromUnixSeconds: parseUnix(url.searchParams.get("from")) } : {}),
    ...(parseUnix(url.searchParams.get("to")) !== undefined ? { toUnixSeconds: parseUnix(url.searchParams.get("to")) } : {}),
    page,
    pageSize,
    sort,
  };
}

export function parseTransactionExportFormat(value: string | null): TransactionExportFormat {
  const parsed = exportFormatSchema.safeParse(value ?? "json");
  if (!parsed.success) {
    throw new ApplicationError("VALIDATION_ERROR", "Export format must be json or csv.", 400);
  }
  return parsed.data;
}
