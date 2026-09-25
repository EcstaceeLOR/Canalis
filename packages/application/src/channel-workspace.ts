import { z } from "zod";
import { ApplicationError } from "./errors.js";

export const channelWorkspaceFilters = ["all", "active", "reserved", "sealed", "settled", "recovered", "recoverable", "expired", "failed"] as const;
export type ChannelWorkspaceFilter = (typeof channelWorkspaceFilters)[number];
export type ChannelListQuery = { owner: string; search?: string; status: ChannelWorkspaceFilter; providerId?: string; page: number; pageSize: number };
export type ChannelAction = "finalize" | "recover" | "inspect" | null;

export type ChannelWorkspaceSummary = {
  id: string; taskId: string; taskName: string; providerId: string; providerName: string; providerPayee: string;
  payer: string; mint: string; network: string; programAddress: string; channelAddress?: string; status: string;
  operationalStatus: Exclude<ChannelWorkspaceFilter, "all">; ceilingAtomic: string; cumulativeAuthorizedAtomic: string;
  spentAtomic: string; remainingEscrowAtomic: string; recoverableAtomic: string; createdAtUnixSeconds: string;
  expiresAtUnixSeconds: string; updatedAtUnixSeconds: string; recoveryStage?: string; recoveryRequired: boolean;
  automaticRetryBlocked: boolean; nextAction: ChannelAction; openTransactionSignature?: string; settleTransactionSignature?: string;
  distributionTransactionSignature?: string; refundTransactionSignature?: string;
};
export type ChannelListResult = { channels: ChannelWorkspaceSummary[]; total: number; page: number; pageSize: number; totalPages: number; counts: Record<Exclude<ChannelWorkspaceFilter, "all">, number> };

export function parseChannelListQuery(url: URL, owner: string): ChannelListQuery {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));
  const search = url.searchParams.get("q")?.trim().slice(0, 160) || undefined;
  const providerId = url.searchParams.get("provider")?.trim().slice(0, 80) || undefined;
  const candidate = url.searchParams.get("status") ?? "all";
  const status = channelWorkspaceFilters.includes(candidate as ChannelWorkspaceFilter) ? (candidate as ChannelWorkspaceFilter) : "all";
  return { owner, ...(search ? { search } : {}), status, ...(providerId ? { providerId } : {}), page, pageSize };
}

export function channelActionFor(input: { status: string; taskStatus: string; cumulativeAuthorizedAtomic: bigint; expiresAtUnixSeconds: bigint; nowUnixSeconds: bigint; recoveryStage?: string; automaticRetryBlocked?: boolean }): ChannelAction {
  if (["distributed", "recovered"].includes(input.status)) return null;
  if (input.status === "failed" || input.automaticRetryBlocked || ["finalization-started", "finalization-ambiguous"].includes(input.recoveryStage ?? "")) return "inspect";
  if (input.status !== "open") return null;
  const expired = input.expiresAtUnixSeconds <= input.nowUnixSeconds;
  const terminalTask = ["completed", "cancelled", "archived"].includes(input.taskStatus);
  if (!terminalTask && !expired) return null;
  return input.cumulativeAuthorizedAtomic === 0n ? "recover" : "finalize";
}

const channelActionSchema = z.object({ action: z.enum(["finalize", "recover"]) }).strict();
export function parseChannelAction(input: unknown): "finalize" | "recover" {
  const parsed = channelActionSchema.safeParse(input);
  if (!parsed.success) throw new ApplicationError("VALIDATION_ERROR", "Channel action must be finalize or recover.", 400, parsed.error.flatten());
  return parsed.data.action;
}
