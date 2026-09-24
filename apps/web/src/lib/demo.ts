import { createHash } from "node:crypto";
import { parseUsdc } from "./money";

export const demoProviderIds = ["search", "data", "inference"] as const;
export type DemoProviderId = (typeof demoProviderIds)[number];

export const demoDefaults = {
  seed: "cwf-2026-v1",
  owner: "demo-owner",
  budgetUsd: "1.00",
  maxPerCallUsd: "0.25",
  allowedProviders: ["search", "data", "inference"] as const,
};

const providerDefinitions: Record<
  DemoProviderId,
  { name: string; priceAtomic: bigint; payee: string }
> = {
  search: {
    name: "Canalis Search",
    priceAtomic: 50_000n,
    payee: "demo:search",
  },
  data: {
    name: "Canalis Data",
    priceAtomic: 30_000n,
    payee: "demo:data",
  },
  inference: {
    name: "Canalis Inference",
    priceAtomic: 120_000n,
    payee: "demo:inference",
  },
};

const minimumProviderPriceAtomic: Record<DemoProviderId, bigint> = {
  search: providerDefinitions.search.priceAtomic,
  data: providerDefinitions.data.priceAtomic,
  inference: providerDefinitions.inference.priceAtomic,
};

export type DemoTaskInput = {
  owner?: string;
  budgetUsd: string;
  maxPerCallUsd: string;
  allowedProviders?: DemoProviderId[];
};

export type DemoReservation = {
  providerId: DemoProviderId;
  ceilingAtomic: bigint;
};

function normalizeProviders(
  requested: DemoProviderId[] | undefined,
): DemoProviderId[] {
  const candidates = requested?.length
    ? requested
    : [...demoDefaults.allowedProviders];
  const unique = [...new Set(candidates)].filter((providerId) =>
    demoProviderIds.includes(providerId),
  );

  if (unique.length === 0) {
    throw new Error("Select at least one provider.");
  }
  return unique;
}

export function allocateDemoReservations(
  budgetAtomic: bigint,
  selectedProviders: readonly DemoProviderId[],
): DemoReservation[] {
  const minimum = selectedProviders.reduce(
    (sum, providerId) => sum + minimumProviderPriceAtomic[providerId],
    0n,
  );

  if (budgetAtomic < minimum) {
    throw new Error(
      `Budget is too small for the selected providers. Minimum required is ${minimum} atomic USDC.`,
    );
  }

  const extra = budgetAtomic - minimum;
  const count = BigInt(selectedProviders.length);
  const equalShare = extra / count;
  let remainder = extra % count;

  return selectedProviders.map((providerId) => {
    const remainderUnit = remainder > 0n ? 1n : 0n;
    if (remainder > 0n) remainder -= 1n;

    return {
      providerId,
      ceilingAtomic:
        minimumProviderPriceAtomic[providerId] + equalShare + remainderUnit,
    };
  });
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deterministicOutput(providerId: DemoProviderId): unknown {
  if (providerId === "search") {
    const query = "Solana payment-channel agent commerce";
    return {
      query,
      results: [1, 2, 3].map((rank) => ({
        rank,
        title: `${query} — result ${rank}`,
        snippet: `Deterministic search evidence ${rank} for ${query}.`,
      })),
    };
  }

  if (providerId === "data") {
    const key = "agent-service-latency";
    const value = [...key].reduce(
      (sum, char) => sum + (char.codePointAt(0) ?? 0),
      0,
    ) % 10_000;
    return {
      key,
      value,
      unit: "index-points",
      source: "canalis-demo-dataset",
    };
  }

  const prompt = "Synthesize the purchased evidence into a short brief";
  return {
    completion: `Canalis synthesized response for: ${prompt}`,
    inputCharacters: prompt.length,
    model: "canalis-demo-1",
  };
}

export async function runDemoTask(
  input: DemoTaskInput,
  nowUnixSeconds = BigInt(Math.floor(Date.now() / 1000)),
) {
  const selectedProviders = normalizeProviders(input.allowedProviders);
  const budgetAtomic = parseUsdc(input.budgetUsd);
  const maxPerCallAtomic = parseUsdc(input.maxPerCallUsd);

  if (budgetAtomic <= 0n) throw new Error("Budget must be greater than zero.");
  if (maxPerCallAtomic <= 0n) {
    throw new Error("Per-call cap must be greater than zero.");
  }

  const reservations = allocateDemoReservations(
    budgetAtomic,
    selectedProviders,
  );
  const taskId = `canalis-demo-${nowUnixSeconds}`;
  const owner = input.owner?.trim() || demoDefaults.owner;

  let tick = nowUnixSeconds;
  let totalSpentAtomic = 0n;
  const flows: Array<{
    id: string;
    taskId: string;
    providerId: DemoProviderId;
    requestId: string;
    status: "fulfilled" | "rejected";
    quotedAmountAtomic: bigint;
    previousCumulativeAtomic: bigint;
    nextCumulativeAtomic: bigint;
    authorizationId?: string;
    paymentReference?: string;
    rejectionCode?: string;
    rejectionMessage?: string;
    receipt?: {
      providerId: DemoProviderId;
      requestId: string;
      mint: string;
      priceAtomic: bigint;
      protocol: "demo";
      authorizationId: string;
      paymentReference: string;
      responseHash: string;
      timestampUnixSeconds: bigint;
    };
    createdAtUnixSeconds: bigint;
  }> = [];
  const steps: Array<{ providerId: DemoProviderId; result: unknown }> = [];
  const providerSpent = new Map<DemoProviderId, bigint>(
    selectedProviders.map((providerId) => [providerId, 0n]),
  );

  for (const providerId of selectedProviders) {
    const definition = providerDefinitions[providerId];
    const requestId = `${providerId}-1`;
    const previousCumulativeAtomic = providerSpent.get(providerId) ?? 0n;
    const createdAtUnixSeconds = tick++;

    if (definition.priceAtomic > maxPerCallAtomic) {
      flows.push({
        id: `${taskId}:${providerId}:${requestId}`,
        taskId,
        providerId,
        requestId,
        status: "rejected",
        quotedAmountAtomic: definition.priceAtomic,
        previousCumulativeAtomic,
        nextCumulativeAtomic: previousCumulativeAtomic,
        rejectionCode: "PER_CALL_CAP_EXCEEDED",
        rejectionMessage: `Provider quote exceeds the ${maxPerCallAtomic} atomic USDC per-call limit.`,
        createdAtUnixSeconds,
      });
      steps.push({
        providerId,
        result: { status: "rejected", code: "PER_CALL_CAP_EXCEEDED" },
      });
      continue;
    }

    const reservation = reservations.find(
      (candidate) => candidate.providerId === providerId,
    );
    if (!reservation || definition.priceAtomic > reservation.ceilingAtomic) {
      flows.push({
        id: `${taskId}:${providerId}:${requestId}`,
        taskId,
        providerId,
        requestId,
        status: "rejected",
        quotedAmountAtomic: definition.priceAtomic,
        previousCumulativeAtomic,
        nextCumulativeAtomic: previousCumulativeAtomic,
        rejectionCode: "PROVIDER_CAP_EXCEEDED",
        rejectionMessage: "Provider channel ceiling is too small for this quote.",
        createdAtUnixSeconds,
      });
      steps.push({
        providerId,
        result: { status: "rejected", code: "PROVIDER_CAP_EXCEEDED" },
      });
      continue;
    }

    if (totalSpentAtomic + definition.priceAtomic > budgetAtomic) {
      flows.push({
        id: `${taskId}:${providerId}:${requestId}`,
        taskId,
        providerId,
        requestId,
        status: "rejected",
        quotedAmountAtomic: definition.priceAtomic,
        previousCumulativeAtomic,
        nextCumulativeAtomic: previousCumulativeAtomic,
        rejectionCode: "TASK_BUDGET_EXCEEDED",
        rejectionMessage: "Task budget cannot cover this provider quote.",
        createdAtUnixSeconds,
      });
      steps.push({
        providerId,
        result: { status: "rejected", code: "TASK_BUDGET_EXCEEDED" },
      });
      continue;
    }

    const nextCumulativeAtomic =
      previousCumulativeAtomic + definition.priceAtomic;
    const output = deterministicOutput(providerId);
    const authorizationId = `auth_${sha256({
      taskId,
      providerId,
      requestId,
      nextCumulativeAtomic: nextCumulativeAtomic.toString(),
    }).slice(0, 20)}`;
    const paymentReference = `demo:${providerId}:${requestId}:${nextCumulativeAtomic}`;

    providerSpent.set(providerId, nextCumulativeAtomic);
    totalSpentAtomic += definition.priceAtomic;

    flows.push({
      id: `${taskId}:${providerId}:${requestId}`,
      taskId,
      providerId,
      requestId,
      status: "fulfilled",
      quotedAmountAtomic: definition.priceAtomic,
      previousCumulativeAtomic,
      nextCumulativeAtomic,
      authorizationId,
      paymentReference,
      receipt: {
        providerId,
        requestId,
        mint: "USDC",
        priceAtomic: definition.priceAtomic,
        protocol: "demo",
        authorizationId,
        paymentReference,
        responseHash: sha256(output),
        timestampUnixSeconds: tick++,
      },
      createdAtUnixSeconds,
    });
    steps.push({ providerId, result: output });
  }

  const providerStates = reservations.map((reservation) => ({
    providerId: reservation.providerId,
    payee: providerDefinitions[reservation.providerId].payee,
    channelCeilingAtomic: reservation.ceilingAtomic,
    cumulativeAuthorizedAtomic:
      providerSpent.get(reservation.providerId) ?? 0n,
    spentAtomic: providerSpent.get(reservation.providerId) ?? 0n,
  }));

  const graph = {
    taskId,
    mint: "USDC",
    budgetAtomic,
    spentAtomic: totalSpentAtomic,
    remainingAtomic: budgetAtomic - totalSpentAtomic,
    reservedCeilingAtomic: reservations.reduce(
      (sum, reservation) => sum + reservation.ceilingAtomic,
      0n,
    ),
    providers: providerStates,
    flows,
    settlements: [] as Array<{
      providerId: string;
      transactionSignature: string;
    }>,
  };

  return {
    demo: {
      mode: "deterministic" as const,
      seed: demoDefaults.seed,
    },
    task: {
      id: taskId,
      owner,
      agentId: "canalis-research-agent",
      allowedProviders: selectedProviders,
      maxPerCallAtomic,
    },
    steps,
    graph,
    settlement: {
      status: "awaiting-onchain-finalization" as const,
      authorizedSpendAtomic: graph.spentAtomic,
      recoverableAtomic: graph.budgetAtomic - graph.spentAtomic,
      transactions: graph.settlements,
    },
  };
}
