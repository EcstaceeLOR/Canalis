import {
  executeProviderRequest,
  type PaymentAuthorizer,
  type ProviderAdapter,
  type ProviderReceipt,
  type ProviderRequest,
} from "@canalis/providers";
import {
  applyApprovedSpend,
  evaluateSpend,
} from "./policy.js";
import type {
  PolicyRejectionCode,
  Task,
  TaskLedger,
} from "./domain.js";

export type ChannelReservation = {
  providerId: string;
  ceilingAtomic: bigint;
};

export type RouteFlowStatus =
  | "authorized"
  | "fulfilled"
  | "rejected"
  | "failed";

export type RouteRejectionCode =
  | PolicyRejectionCode
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_NOT_RESERVED"
  | "MINT_MISMATCH";

export type RouteFlow = {
  id: string;
  taskId: string;
  providerId: string;
  requestId: string;
  status: RouteFlowStatus;
  quotedAmountAtomic: bigint;
  previousCumulativeAtomic: bigint;
  nextCumulativeAtomic: bigint;
  rejectionCode?: RouteRejectionCode;
  rejectionMessage?: string;
  authorizationId?: string;
  paymentReference?: string;
  receipt?: ProviderReceipt;
  errorMessage?: string;
  settlementTransactionSignature?: string;
  createdAtUnixSeconds: bigint;
};

export type ProviderRouteState = {
  providerId: string;
  channelCeilingAtomic: bigint;
  cumulativeAuthorizedAtomic: bigint;
  spentAtomic: bigint;
};

export type RouteSettlementRecord = {
  providerId: string;
  cumulativeAmountAtomic: bigint;
  transactionSignature: string;
};

export type TaskPaymentGraph = {
  taskId: string;
  mint: string;
  budgetAtomic: bigint;
  spentAtomic: bigint;
  remainingAtomic: bigint;
  reservedCeilingAtomic: bigint;
  providers: ProviderRouteState[];
  flows: RouteFlow[];
  settlements: RouteSettlementRecord[];
};

export type RouteExecutionResult<TOutput = unknown> =
  | {
      ok: true;
      output: TOutput;
      flow: RouteFlow;
    }
  | {
      ok: false;
      flow: RouteFlow;
    };

type MutableProviderRouteState = ProviderRouteState;

type ProviderRegistry = Record<string, ProviderAdapter<any, any>>;

class RouteRejectedError extends Error {
  constructor(readonly flow: RouteFlow) {
    super(flow.rejectionMessage ?? "Canalis route rejected payment authorization");
    this.name = "RouteRejectedError";
  }
}

function copyFlow(flow: RouteFlow): RouteFlow {
  return { ...flow, receipt: flow.receipt ? { ...flow.receipt } : undefined };
}

export class CanalisRouteOrchestrator {
  private ledger: TaskLedger;
  private readonly providerStates = new Map<string, MutableProviderRouteState>();
  private readonly flows: RouteFlow[] = [];
  private readonly settlements: RouteSettlementRecord[] = [];

  constructor(
    readonly task: Task,
    private readonly providers: ProviderRegistry,
    reservations: readonly ChannelReservation[],
    private readonly nowUnixSeconds: () => bigint = () =>
      BigInt(Math.floor(Date.now() / 1000)),
  ) {
    this.ledger = {
      taskId: task.id,
      spentAtomic: 0n,
      providerSpentAtomic: {},
    };

    let totalReserved = 0n;
    const seen = new Set<string>();

    for (const reservation of reservations) {
      if (seen.has(reservation.providerId)) {
        throw new Error(`duplicate channel reservation: ${reservation.providerId}`);
      }
      seen.add(reservation.providerId);

      if (reservation.ceilingAtomic <= 0n) {
        throw new Error("channel reservation ceiling must be positive");
      }
      if (!providers[reservation.providerId]) {
        throw new Error(`cannot reserve unknown provider: ${reservation.providerId}`);
      }
      if (!task.policy.allowedProviderIds.includes(reservation.providerId)) {
        throw new Error(
          `cannot reserve provider outside task allowlist: ${reservation.providerId}`,
        );
      }

      const providerCap = task.policy.providerCapsAtomic?.[reservation.providerId];
      if (providerCap !== undefined && reservation.ceilingAtomic > providerCap) {
        throw new Error(
          `channel reservation exceeds provider cap: ${reservation.providerId}`,
        );
      }

      totalReserved += reservation.ceilingAtomic;
      if (totalReserved > task.budget.totalAtomic) {
        throw new Error("aggregate channel reservations exceed task budget");
      }

      this.providerStates.set(reservation.providerId, {
        providerId: reservation.providerId,
        channelCeilingAtomic: reservation.ceilingAtomic,
        cumulativeAuthorizedAtomic: 0n,
        spentAtomic: 0n,
      });
    }
  }

  async execute<TInput, TOutput>(
    providerId: string,
    request: ProviderRequest<TInput>,
  ): Promise<RouteExecutionResult<TOutput>> {
    const provider = this.providers[providerId] as
      | ProviderAdapter<TInput, TOutput>
      | undefined;
    const state = this.providerStates.get(providerId);

    if (!provider) {
      return { ok: false, flow: this.recordImmediateRejection(providerId, request.requestId, "PROVIDER_NOT_FOUND", "The provider is not registered.") };
    }
    if (!state) {
      return { ok: false, flow: this.recordImmediateRejection(providerId, request.requestId, "PROVIDER_NOT_RESERVED", "No task channel ceiling was reserved for this provider.") };
    }

    let activeFlow: RouteFlow | undefined;

    const authorizer: PaymentAuthorizer = {
      authorize: async (quote) => {
        const previousCumulativeAtomic = state.cumulativeAuthorizedAtomic;
        const nextCumulativeAtomic = previousCumulativeAtomic + quote.priceAtomic;
        const createdAtUnixSeconds = this.nowUnixSeconds();

        if (quote.mint !== this.task.budget.mint) {
          activeFlow = this.pushRejectedFlow({
            providerId,
            requestId: request.requestId,
            quotedAmountAtomic: quote.priceAtomic,
            previousCumulativeAtomic,
            nextCumulativeAtomic,
            code: "MINT_MISMATCH",
            message: "The provider quote mint does not match the task budget mint.",
            createdAtUnixSeconds,
          });
          throw new RouteRejectedError(activeFlow);
        }

        const decision = evaluateSpend({
          task: this.task,
          ledger: this.ledger,
          providerId,
          quotedAmountAtomic: quote.priceAtomic,
          currentProviderCumulativeAtomic: previousCumulativeAtomic,
          nextProviderCumulativeAtomic: nextCumulativeAtomic,
          channelCeilingAtomic: state.channelCeilingAtomic,
          nowUnixSeconds: createdAtUnixSeconds,
        });

        if (!decision.allowed) {
          activeFlow = this.pushRejectedFlow({
            providerId,
            requestId: request.requestId,
            quotedAmountAtomic: quote.priceAtomic,
            previousCumulativeAtomic,
            nextCumulativeAtomic,
            code: decision.code,
            message: decision.message,
            createdAtUnixSeconds,
          });
          throw new RouteRejectedError(activeFlow);
        }

        this.ledger = applyApprovedSpend(this.ledger, providerId, decision);
        state.cumulativeAuthorizedAtomic = decision.nextProviderCumulativeAtomic;
        state.spentAtomic = decision.projectedProviderSpendAtomic;

        const authorizationId = `${this.task.id}:${providerId}:${request.requestId}`;
        const paymentReference = `canalis:${this.task.id}:${providerId}:${decision.nextProviderCumulativeAtomic}`;

        activeFlow = {
          id: authorizationId,
          taskId: this.task.id,
          providerId,
          requestId: request.requestId,
          status: "authorized",
          quotedAmountAtomic: quote.priceAtomic,
          previousCumulativeAtomic,
          nextCumulativeAtomic: decision.nextProviderCumulativeAtomic,
          authorizationId,
          paymentReference,
          createdAtUnixSeconds,
        };
        this.flows.push(activeFlow);

        return {
          authorizationId,
          providerId,
          requestId: request.requestId,
          mint: quote.mint,
          amountAtomic: quote.priceAtomic,
          protocol: quote.protocol,
          paymentReference,
        };
      },
    };

    try {
      const result = await executeProviderRequest(
        provider,
        request,
        authorizer,
        { nowUnixSeconds: this.nowUnixSeconds },
      );

      if (!activeFlow) {
        throw new Error("provider completed without a Canalis authorization flow");
      }

      activeFlow.status = "fulfilled";
      activeFlow.receipt = result.receipt;

      return {
        ok: true,
        output: result.output,
        flow: copyFlow(activeFlow),
      };
    } catch (error) {
      if (error instanceof RouteRejectedError) {
        return { ok: false, flow: copyFlow(error.flow) };
      }

      if (activeFlow) {
        activeFlow.status = "failed";
        activeFlow.errorMessage =
          error instanceof Error ? error.message : "Unknown provider failure";
      }
      throw error;
    }
  }

  recordSettlement(record: RouteSettlementRecord): void {
    const state = this.providerStates.get(record.providerId);
    if (!state) {
      throw new Error(`cannot record settlement for unknown route: ${record.providerId}`);
    }
    if (record.cumulativeAmountAtomic < 0n) {
      throw new Error("settlement cumulative amount must not be negative");
    }
    if (record.cumulativeAmountAtomic > state.cumulativeAuthorizedAtomic) {
      throw new Error("settlement cannot exceed cumulative authorized spend");
    }

    this.settlements.push({ ...record });
    for (const flow of this.flows) {
      if (
        flow.providerId === record.providerId &&
        flow.status === "fulfilled" &&
        flow.nextCumulativeAtomic <= record.cumulativeAmountAtomic
      ) {
        flow.settlementTransactionSignature = record.transactionSignature;
      }
    }
  }

  getPaymentGraph(): TaskPaymentGraph {
    const providers = [...this.providerStates.values()].map((state) => ({
      ...state,
    }));
    const reservedCeilingAtomic = providers.reduce(
      (sum, state) => sum + state.channelCeilingAtomic,
      0n,
    );

    return {
      taskId: this.task.id,
      mint: this.task.budget.mint,
      budgetAtomic: this.task.budget.totalAtomic,
      spentAtomic: this.ledger.spentAtomic,
      remainingAtomic: this.task.budget.totalAtomic - this.ledger.spentAtomic,
      reservedCeilingAtomic,
      providers,
      flows: this.flows.map(copyFlow),
      settlements: this.settlements.map((record) => ({ ...record })),
    };
  }

  private recordImmediateRejection(
    providerId: string,
    requestId: string,
    code: RouteRejectionCode,
    message: string,
  ): RouteFlow {
    return this.pushRejectedFlow({
      providerId,
      requestId,
      quotedAmountAtomic: 0n,
      previousCumulativeAtomic: 0n,
      nextCumulativeAtomic: 0n,
      code,
      message,
      createdAtUnixSeconds: this.nowUnixSeconds(),
    });
  }

  private pushRejectedFlow(input: {
    providerId: string;
    requestId: string;
    quotedAmountAtomic: bigint;
    previousCumulativeAtomic: bigint;
    nextCumulativeAtomic: bigint;
    code: RouteRejectionCode;
    message: string;
    createdAtUnixSeconds: bigint;
  }): RouteFlow {
    const flow: RouteFlow = {
      id: `${this.task.id}:${input.providerId}:${input.requestId}:rejected:${this.flows.length}`,
      taskId: this.task.id,
      providerId: input.providerId,
      requestId: input.requestId,
      status: "rejected",
      quotedAmountAtomic: input.quotedAmountAtomic,
      previousCumulativeAtomic: input.previousCumulativeAtomic,
      nextCumulativeAtomic: input.nextCumulativeAtomic,
      rejectionCode: input.code,
      rejectionMessage: input.message,
      createdAtUnixSeconds: input.createdAtUnixSeconds,
    };
    this.flows.push(flow);
    return flow;
  }
}
