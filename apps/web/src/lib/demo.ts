import {
  CanalisRouteOrchestrator,
  type ChannelReservation,
  type Task,
} from "@canalis/core";
import {
  DemoDataProvider,
  DemoInferenceProvider,
  DemoSearchProvider,
} from "@canalis/providers";
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

const providers = {
  search: new DemoSearchProvider(),
  data: new DemoDataProvider(),
  inference: new DemoInferenceProvider(),
};

const minimumProviderPriceAtomic: Record<DemoProviderId, bigint> = {
  search: 50_000n,
  data: 30_000n,
  inference: 120_000n,
};

export type DemoTaskInput = {
  owner?: string;
  budgetUsd: string;
  maxPerCallUsd: string;
  allowedProviders?: DemoProviderId[];
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
): ChannelReservation[] {
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

  const reservations = allocateDemoReservations(budgetAtomic, selectedProviders);
  const providerCapsAtomic = Object.fromEntries(
    reservations.map((reservation) => [
      reservation.providerId,
      reservation.ceilingAtomic,
    ]),
  ) as Record<string, bigint>;

  const task: Task = {
    id: `canalis-demo-${nowUnixSeconds}`,
    owner: input.owner?.trim() || demoDefaults.owner,
    agentId: "canalis-research-agent",
    budget: { mint: "USDC", totalAtomic: budgetAtomic },
    policy: {
      allowedProviderIds: selectedProviders,
      maxPerCallAtomic,
      providerCapsAtomic,
    },
    status: "active",
    createdAtUnixSeconds: nowUnixSeconds,
    expiresAtUnixSeconds: nowUnixSeconds + 15n * 60n,
  };

  let tick = nowUnixSeconds;
  const orchestrator = new CanalisRouteOrchestrator(
    task,
    providers,
    reservations,
    () => tick++,
  );

  const steps: Array<{ providerId: DemoProviderId; result: unknown }> = [];

  if (selectedProviders.includes("search")) {
    steps.push({
      providerId: "search",
      result: await orchestrator.execute("search", {
        requestId: "search-1",
        input: { query: "Solana payment-channel agent commerce" },
      }),
    });
  }

  if (selectedProviders.includes("data")) {
    steps.push({
      providerId: "data",
      result: await orchestrator.execute("data", {
        requestId: "data-1",
        input: { key: "agent-service-latency" },
      }),
    });
  }

  if (selectedProviders.includes("inference")) {
    steps.push({
      providerId: "inference",
      result: await orchestrator.execute("inference", {
        requestId: "inference-1",
        input: { prompt: "Synthesize the purchased evidence into a short brief" },
      }),
    });
  }

  const graph = orchestrator.getPaymentGraph();

  return {
    demo: {
      mode: "deterministic" as const,
      seed: demoDefaults.seed,
    },
    task: {
      id: task.id,
      owner: task.owner,
      agentId: task.agentId,
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
