import { randomUUID } from "node:crypto";
import {
  CanalisRouteOrchestrator,
  type ChannelReservation,
  type RouteFlow,
  type TaskPaymentGraph,
} from "@canalis/core";
import {
  demoProviders,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderReceipt,
} from "@canalis/providers";
import {
  CANALIS_DEVNET_SANDBOX_MINT,
  CANALIS_LIVE_SANDBOX_MAX_TASK_ATOMIC,
  PAYMENT_CHANNELS_PROGRAM_ADDRESS,
  SOLANA_DEVNET_CAIP2,
  liveProviderAddress,
} from "@canalis/solana";
import {
  parseCreateTaskRequest,
  parseUsdc,
  type CreateTaskRequest,
  type DeterministicProviderId,
  type SerializedFlow,
  type SerializedReceipt,
  type TaskDetailDto,
} from "./contracts.js";
import { ApplicationError } from "./errors.js";
import type {
  CanalisRepository,
  ChannelUpdate,
  PersistedChannel,
  PersistedTask,
} from "./repository.js";

function allocateReservations(
  budgetAtomic: bigint,
  providerIds: readonly string[],
): ChannelReservation[] {
  const count = BigInt(providerIds.length);
  if (budgetAtomic < count) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Task budget is too small for the selected provider reservations.",
      400,
    );
  }

  const base = budgetAtomic / count;
  let remainder = budgetAtomic % count;
  return providerIds.map((providerId) => {
    const extra = remainder > 0n ? 1n : 0n;
    if (remainder > 0n) remainder -= 1n;
    return { providerId, ceilingAtomic: base + extra };
  });
}

function deterministicRequest(providerId: DeterministicProviderId): ProviderRequest<unknown> {
  if (providerId === "search") {
    return {
      requestId: "search-1",
      input: { query: "Solana payment-channel agent commerce" },
    };
  }
  if (providerId === "data") {
    return {
      requestId: "data-1",
      input: { key: "agent-service-latency" },
    };
  }
  return {
    requestId: "inference-1",
    input: { prompt: "Synthesize the purchased evidence into a short brief" },
  };
}

function liveProviders(mint: string): Record<string, ProviderAdapter<any, any>> {
  return Object.fromEntries(
    Object.entries(demoProviders).map(([providerId, provider]) => [
      providerId,
      {
        metadata: {
          ...provider.metadata,
          payee: liveProviderAddress(providerId),
          protocol: "x402" as const,
          description: `${provider.metadata.description} Metered through a live Solana devnet payment channel.`,
        },
        async quote(request: ProviderRequest<any>) {
          const quote = await provider.quote(request as never);
          return {
            ...quote,
            mint,
            protocol: "x402" as const,
            protocolMetadata: {
              scheme: "upto",
              network: SOLANA_DEVNET_CAIP2,
            },
          };
        },
        async fulfillAuthorized(request: ProviderRequest<any>, quote: any, authorization: any) {
          return provider.fulfillAuthorized(request as never, quote, authorization);
        },
      } satisfies ProviderAdapter<any, any>,
    ]),
  );
}

function serializeReceipt(receipt: ProviderReceipt): SerializedReceipt {
  return {
    providerId: receipt.providerId,
    requestId: receipt.requestId,
    mint: receipt.mint,
    priceAtomic: receipt.priceAtomic.toString(),
    protocol: receipt.protocol,
    authorizationId: receipt.authorizationId,
    ...(receipt.paymentReference ? { paymentReference: receipt.paymentReference } : {}),
    responseHash: receipt.responseHash,
    timestampUnixSeconds: receipt.timestampUnixSeconds.toString(),
    ...(receipt.protocolMetadata ? { protocolMetadata: receipt.protocolMetadata } : {}),
  };
}

function serializeFlow(flow: RouteFlow): SerializedFlow {
  return {
    id: flow.id,
    taskId: flow.taskId,
    providerId: flow.providerId,
    requestId: flow.requestId,
    status: flow.status,
    quotedAmountAtomic: flow.quotedAmountAtomic.toString(),
    previousCumulativeAtomic: flow.previousCumulativeAtomic.toString(),
    nextCumulativeAtomic: flow.nextCumulativeAtomic.toString(),
    ...(flow.rejectionCode ? { rejectionCode: flow.rejectionCode } : {}),
    ...(flow.rejectionMessage ? { rejectionMessage: flow.rejectionMessage } : {}),
    ...(flow.authorizationId ? { authorizationId: flow.authorizationId } : {}),
    ...(flow.paymentReference ? { paymentReference: flow.paymentReference } : {}),
    ...(flow.receipt ? { receipt: serializeReceipt(flow.receipt) } : {}),
    ...(flow.errorMessage ? { errorMessage: flow.errorMessage } : {}),
    ...(flow.settlementTransactionSignature
      ? { settlementTransactionSignature: flow.settlementTransactionSignature }
      : {}),
    createdAtUnixSeconds: flow.createdAtUnixSeconds.toString(),
  };
}

export class CanalisApplication {
  constructor(
    private readonly repository: CanalisRepository,
    private readonly nowUnixSeconds: () => bigint = () =>
      BigInt(Math.floor(Date.now() / 1000)),
  ) {}

  async createTask(input: CreateTaskRequest | unknown): Promise<TaskDetailDto> {
    const parsed = parseCreateTaskRequest(input);
    const budgetAtomic = parseUsdc(parsed.budgetUsd);
    const maxPerCallAtomic = parseUsdc(parsed.maxPerCallUsd);

    if (budgetAtomic <= 0n || maxPerCallAtomic <= 0n) {
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Budget and per-call cap must both be greater than zero.",
        400,
      );
    }
    if (parsed.mode === "x402" && budgetAtomic > CANALIS_LIVE_SANDBOX_MAX_TASK_ATOMIC) {
      throw new ApplicationError(
        "LIVE_SANDBOX_BUDGET_EXCEEDED",
        "Live devnet sandbox tasks are capped at 5 test USDC.",
        400,
      );
    }

    const now = this.nowUnixSeconds();
    const reservations = allocateReservations(budgetAtomic, parsed.allowedProviders);
    const providerCapsAtomic = Object.fromEntries(
      reservations.map((reservation) => [
        reservation.providerId,
        reservation.ceilingAtomic,
      ]),
    );

    const task: PersistedTask = {
      id: `task_${randomUUID()}`,
      owner: parsed.owner,
      agentId: parsed.agentId,
      budget: {
        mint: parsed.mode === "x402" ? CANALIS_DEVNET_SANDBOX_MINT : "USDC",
        totalAtomic: budgetAtomic,
      },
      policy: {
        allowedProviderIds: parsed.allowedProviders,
        maxPerCallAtomic,
        providerCapsAtomic,
      },
      status: parsed.initialStatus,
      createdAtUnixSeconds: now,
      expiresAtUnixSeconds: now + BigInt(parsed.expiryMinutes) * 60n,
      mode: parsed.mode,
      updatedAtUnixSeconds: now,
    };

    const channels: PersistedChannel[] = reservations.map((reservation) => ({
      taskId: task.id,
      providerId: reservation.providerId,
      programAddress: PAYMENT_CHANNELS_PROGRAM_ADDRESS,
      network: SOLANA_DEVNET_CAIP2,
      ceilingAtomic: reservation.ceilingAtomic,
      cumulativeAuthorizedAtomic: 0n,
      spentAtomic: 0n,
      status: "reserved",
      createdAtUnixSeconds: now,
      updatedAtUnixSeconds: now,
    }));

    await this.repository.createTask(task, channels);
    return this.getTask(task.id);
  }

  async executeTask(taskId: string): Promise<TaskDetailDto> {
    const task = await this.requireTask(taskId);
    if (task.mode !== "deterministic" && task.mode !== "x402") {
      throw new ApplicationError(
        "PROVIDER_MODE_UNSUPPORTED",
        `Task mode ${task.mode} is not executable by the current Canalis runner.`,
        409,
      );
    }
    if (task.status !== "active") {
      throw new ApplicationError(
        "TASK_ALREADY_EXECUTED",
        "This task is not active and cannot be executed.",
        409,
      );
    }

    const existingFlows = await this.repository.getFlows(task.id);
    if (existingFlows.length > 0) {
      throw new ApplicationError(
        "TASK_ALREADY_EXECUTED",
        "This task already has an execution history.",
        409,
      );
    }

    const channels = await this.repository.getChannels(task.id);
    if (task.mode === "x402") {
      const unopened = channels.filter((channel) => channel.status !== "open");
      if (unopened.length > 0) {
        throw new ApplicationError(
          "LIVE_CHANNELS_NOT_OPEN",
          `Open every live provider channel before execution. Pending: ${unopened.map((channel) => channel.providerId).join(", ")}.`,
          409,
        );
      }
    }

    const reservations: ChannelReservation[] = channels.map((channel) => ({
      providerId: channel.providerId,
      ceilingAtomic: channel.ceilingAtomic,
    }));
    const providers = task.mode === "x402" ? liveProviders(task.budget.mint) : demoProviders;
    const orchestrator = new CanalisRouteOrchestrator(
      task,
      providers,
      reservations,
      this.nowUnixSeconds,
    );

    let executionFailure: unknown;
    for (const providerId of task.policy.allowedProviderIds) {
      try {
        await orchestrator.execute(
          providerId,
          deterministicRequest(providerId as DeterministicProviderId),
        );
      } catch (error) {
        executionFailure = error;
        break;
      }
    }

    const graph = orchestrator.getPaymentGraph();
    const now = this.nowUnixSeconds();
    await this.repository.saveExecution(
      task.id,
      graph,
      executionFailure ? "active" : "completed",
      now,
    );

    if (executionFailure) {
      throw new ApplicationError(
        "PROVIDER_EXECUTION_FAILED",
        executionFailure instanceof Error
          ? executionFailure.message
          : "Provider execution failed.",
        502,
      );
    }

    return this.getTask(task.id);
  }

  async getTask(taskId: string): Promise<TaskDetailDto> {
    const task = await this.requireTask(taskId);
    const [channels, flows, settlements] = await Promise.all([
      this.repository.getChannels(taskId),
      this.repository.getFlows(taskId),
      this.repository.getSettlements(taskId),
    ]);

    const spentAtomic = channels.reduce((sum, channel) => sum + channel.spentAtomic, 0n);
    const reservedCeilingAtomic = channels.reduce(
      (sum, channel) => sum + channel.ceilingAtomic,
      0n,
    );
    const terminalChannels = channels.filter((channel) =>
      ["distributed", "recovered"].includes(channel.status),
    ).length;
    const settlementStatus =
      channels.length > 0 && terminalChannels === channels.length
        ? "finalized"
        : terminalChannels > 0 || settlements.length > 0
          ? "partially-finalized"
          : "awaiting-onchain-finalization";

    const graph: TaskPaymentGraph = {
      taskId,
      mint: task.budget.mint,
      budgetAtomic: task.budget.totalAtomic,
      spentAtomic,
      remainingAtomic: task.budget.totalAtomic - spentAtomic,
      reservedCeilingAtomic,
      providers: channels.map((channel) => ({
        providerId: channel.providerId,
        channelCeilingAtomic: channel.ceilingAtomic,
        cumulativeAuthorizedAtomic: channel.cumulativeAuthorizedAtomic,
        spentAtomic: channel.spentAtomic,
      })),
      flows,
      settlements,
    };

    return {
      task: {
        id: task.id,
        owner: task.owner,
        agentId: task.agentId,
        mode: task.mode,
        status: task.status,
        mint: task.budget.mint,
        budgetAtomic: task.budget.totalAtomic.toString(),
        allowedProviders: task.policy.allowedProviderIds,
        ...(task.policy.maxPerCallAtomic !== undefined
          ? { maxPerCallAtomic: task.policy.maxPerCallAtomic.toString() }
          : {}),
        createdAtUnixSeconds: task.createdAtUnixSeconds.toString(),
        expiresAtUnixSeconds: task.expiresAtUnixSeconds.toString(),
      },
      graph: {
        taskId: graph.taskId,
        mint: graph.mint,
        budgetAtomic: graph.budgetAtomic.toString(),
        spentAtomic: graph.spentAtomic.toString(),
        remainingAtomic: graph.remainingAtomic.toString(),
        reservedCeilingAtomic: graph.reservedCeilingAtomic.toString(),
        providers: graph.providers.map((provider) => ({
          providerId: provider.providerId,
          channelCeilingAtomic: provider.channelCeilingAtomic.toString(),
          cumulativeAuthorizedAtomic: provider.cumulativeAuthorizedAtomic.toString(),
          spentAtomic: provider.spentAtomic.toString(),
        })),
        flows: graph.flows.map(serializeFlow),
        settlements: graph.settlements.map((settlement) => ({
          providerId: settlement.providerId,
          cumulativeAmountAtomic: settlement.cumulativeAmountAtomic.toString(),
          transactionSignature: settlement.transactionSignature,
        })),
      },
      channels: channels.map((channel) => ({
        providerId: channel.providerId,
        programAddress: channel.programAddress,
        network: channel.network,
        ...(channel.channelAddress ? { channelAddress: channel.channelAddress } : {}),
        status: channel.status,
        ceilingAtomic: channel.ceilingAtomic.toString(),
        cumulativeAuthorizedAtomic: channel.cumulativeAuthorizedAtomic.toString(),
        spentAtomic: channel.spentAtomic.toString(),
        ...(channel.openTransactionSignature
          ? { openTransactionSignature: channel.openTransactionSignature }
          : {}),
        ...(channel.settleTransactionSignature
          ? { settleTransactionSignature: channel.settleTransactionSignature }
          : {}),
        ...(channel.distributionTransactionSignature
          ? { distributionTransactionSignature: channel.distributionTransactionSignature }
          : {}),
        ...(channel.refundTransactionSignature
          ? { refundTransactionSignature: channel.refundTransactionSignature }
          : {}),
        ...(channel.recoveryState ? { recoveryState: channel.recoveryState } : {}),
      })),
      settlement: {
        status: settlementStatus,
        authorizedSpendAtomic: graph.spentAtomic.toString(),
        recoverableAtomic: graph.remainingAtomic.toString(),
        transactions: settlements.map((settlement) => ({
          providerId: settlement.providerId,
          transactionSignature: settlement.transactionSignature,
        })),
      },
    };
  }

  async listTasks(limit = 50) {
    const tasks = await this.repository.listTasks(Math.max(1, Math.min(limit, 100)));
    return Promise.all(tasks.map((task) => this.getTask(task.id)));
  }

  async recordChannelState(
    taskId: string,
    providerId: string,
    update: ChannelUpdate,
  ): Promise<TaskDetailDto> {
    await this.requireTask(taskId);
    const channels = await this.repository.getChannels(taskId);
    if (!channels.some((channel) => channel.providerId === providerId)) {
      throw new ApplicationError(
        "CHANNEL_NOT_FOUND",
        `No channel reservation exists for provider ${providerId}.`,
        404,
      );
    }
    await this.repository.updateChannel(
      taskId,
      providerId,
      update,
      this.nowUnixSeconds(),
    );
    return this.getTask(taskId);
  }

  async listProviders() {
    return this.repository.listProviders();
  }

  private async requireTask(taskId: string): Promise<PersistedTask> {
    const normalized = taskId.trim();
    if (!normalized) {
      throw new ApplicationError("VALIDATION_ERROR", "Task id is required.", 400);
    }
    const task = await this.repository.getTask(normalized);
    if (!task) {
      throw new ApplicationError("TASK_NOT_FOUND", "Task not found.", 404);
    }
    return task;
  }
}
