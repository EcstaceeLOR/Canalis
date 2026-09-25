import { z } from "zod";
import type { TaskStatus } from "@canalis/core";
import { deterministicProviderIds } from "./contracts.js";
import { ApplicationError } from "./errors.js";

const money = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, "Use a non-negative USDC amount with at most 6 decimals.");

export const taskWorkspaceCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  agentId: z.string().trim().min(1).max(128).default("canalis-research-agent"),
  budgetUsd: money.default("1.00"),
  maxPerCallUsd: money.default("0.25"),
  expiryMinutes: z.coerce.number().int().min(1).max(10_080).default(60),
  allowedProviders: z
    .array(z.enum(deterministicProviderIds))
    .min(1)
    .max(deterministicProviderIds.length)
    .default([...deterministicProviderIds]),
  policyId: z.string().trim().min(1).max(80).default("inline-bounded"),
  mode: z.enum(["deterministic", "x402"]).default("deterministic"),
  saveAsDraft: z.boolean().default(false),
}).strict();

export type TaskWorkspaceCreateInput = z.output<typeof taskWorkspaceCreateSchema>;

export function parseTaskWorkspaceCreate(input: unknown): TaskWorkspaceCreateInput {
  const parsed = taskWorkspaceCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Task workspace request validation failed.",
      400,
      parsed.error.flatten(),
    );
  }
  return { ...parsed.data, allowedProviders: [...new Set(parsed.data.allowedProviders)] };
}

export const taskStatuses = ["draft", "active", "completed", "cancelled", "archived"] as const;
export type TaskWorkspaceSort = "updated_desc" | "created_desc" | "created_asc" | "name_asc";

export type TaskListQuery = {
  owner: string;
  search?: string;
  statuses?: TaskStatus[];
  providerId?: string;
  createdFromUnixSeconds?: bigint;
  createdToUnixSeconds?: bigint;
  sort: TaskWorkspaceSort;
  page: number;
  pageSize: number;
};

export type TaskWorkspaceSummary = {
  id: string;
  name: string;
  description: string;
  owner: string;
  agentId: string;
  mode: string;
  status: TaskStatus;
  mint: string;
  budgetAtomic: string;
  spentAtomic: string;
  recoverableAtomic: string;
  allowedProviders: string[];
  policyId: string;
  createdAtUnixSeconds: string;
  expiresAtUnixSeconds: string;
  updatedAtUnixSeconds: string;
};

export type TaskListResult = {
  tasks: TaskWorkspaceSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type TaskWorkspaceMetadata = {
  taskId: string;
  name: string;
  description: string;
  policyId: string;
};

export type TaskLifecycleAction = "submit" | "cancel" | "archive" | "duplicate" | "rerun";

export const taskLifecycleSchema = z.object({
  action: z.enum(["submit", "cancel", "archive", "duplicate", "rerun"]),
}).strict();

export function parseTaskLifecycle(input: unknown): TaskLifecycleAction {
  const parsed = taskLifecycleSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApplicationError("VALIDATION_ERROR", "Invalid task lifecycle action.", 400, parsed.error.flatten());
  }
  return parsed.data.action;
}

export function parseTaskListQuery(url: URL, owner: string): TaskListQuery {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.max(1, Math.min(50, Number.parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));
  const search = url.searchParams.get("q")?.trim().slice(0, 120) || undefined;
  const providerId = url.searchParams.get("provider")?.trim() || undefined;
  const statuses = (url.searchParams.get("status") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is TaskStatus => (taskStatuses as readonly string[]).includes(value));
  const sortRaw = url.searchParams.get("sort") ?? "updated_desc";
  const sort: TaskWorkspaceSort = ["updated_desc", "created_desc", "created_asc", "name_asc"].includes(sortRaw)
    ? (sortRaw as TaskWorkspaceSort)
    : "updated_desc";
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const parseTime = (value: string | null) => {
    if (!value) return undefined;
    try {
      const parsed = BigInt(value);
      return parsed >= 0n ? parsed : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    owner,
    ...(search ? { search } : {}),
    ...(statuses.length ? { statuses } : {}),
    ...(providerId ? { providerId } : {}),
    ...(parseTime(fromRaw) !== undefined ? { createdFromUnixSeconds: parseTime(fromRaw) } : {}),
    ...(parseTime(toRaw) !== undefined ? { createdToUnixSeconds: parseTime(toRaw) } : {}),
    sort,
    page,
    pageSize,
  };
}
