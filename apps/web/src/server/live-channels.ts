import { ApplicationError, type TaskDetailDto } from "@canalis/application";
import { PostgresLiveChannelRepository } from "@canalis/persistence";
import { DevnetX402ChannelGateway } from "@canalis/solana";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";

let gateway: DevnetX402ChannelGateway | undefined;
let settlementRepository: PostgresLiveChannelRepository | undefined;

export function getLiveChannelGateway(): DevnetX402ChannelGateway {
  gateway ??= new DevnetX402ChannelGateway();
  return gateway;
}

export function getLiveSettlementRepository(): PostgresLiveChannelRepository {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new ApplicationError(
      "STORAGE_NOT_CONFIGURED",
      "Canalis durable storage is not configured.",
      503,
    );
  }
  settlementRepository ??= new PostgresLiveChannelRepository(databaseUrl);
  return settlementRepository;
}

export function requireLiveTask(task: TaskDetailDto): void {
  if (task.task.mode !== "x402") {
    throw new ApplicationError(
      "LIVE_CHANNEL_MODE_REQUIRED",
      "This operation is available only for x402 live-devnet tasks.",
      409,
    );
  }
}

export function paymentRequiredFromChannel(
  channel: TaskDetailDto["channels"][number],
): PaymentRequired {
  const candidate = channel.recoveryState?.paymentRequired as PaymentRequired | undefined;
  if (
    !candidate ||
    candidate.x402Version !== 2 ||
    !Array.isArray(candidate.accepts) ||
    candidate.accepts.length !== 1 ||
    !candidate.accepts[0]
  ) {
    throw new ApplicationError(
      "LIVE_CHANNEL_NOT_PREPARED",
      `Provider ${channel.providerId} does not have a persisted live channel requirement.`,
      409,
    );
  }
  return candidate;
}

export function parsePaymentPayload(input: unknown): PaymentPayload {
  const body = input as { paymentPayload?: unknown } | null;
  const candidate = body?.paymentPayload as PaymentPayload | undefined;
  if (
    !candidate ||
    candidate.x402Version !== 2 ||
    typeof candidate.payload !== "object" ||
    candidate.payload === null ||
    typeof candidate.accepted !== "object" ||
    candidate.accepted === null
  ) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A valid x402 v2 paymentPayload is required.",
      400,
    );
  }
  return candidate;
}

export async function resetLiveChannelRuntimeForTests(): Promise<void> {
  if (settlementRepository) await settlementRepository.close();
  settlementRepository = undefined;
  gateway = undefined;
}
