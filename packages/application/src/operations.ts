import { ApplicationError } from "./errors.js";

export const analyticsRangePresets = ["24h", "7d", "30d", "custom"] as const;
export type AnalyticsRangePreset = (typeof analyticsRangePresets)[number];

export type OperationsAnalyticsRangeQuery = {
  preset: AnalyticsRangePreset;
  fromUnixSeconds: bigint;
  toUnixSeconds: bigint;
  bucketSeconds: number;
};

export type OperationsAnalyticsRange = {
  preset: AnalyticsRangePreset;
  fromUnixSeconds: string;
  toUnixSeconds: string;
  bucketSeconds: number;
};

export type OperationalTaskSummary = {
  id: string;
  name: string;
  status: string;
  mode: string;
  budgetAtomic: string;
  spentAtomic: string;
  recoverableAtomic: string;
  updatedAtUnixSeconds: string;
};

export type OperationalChannelAction = {
  id: string;
  taskId: string;
  taskName: string;
  providerId: string;
  providerName: string;
  network: string;
  operationalStatus: "failed" | "recoverable" | "expired" | "sealed";
  recoverableAtomic: string;
  updatedAtUnixSeconds: string;
  nextAction: "inspect" | "recover" | "finalize";
};

export type OperationalProviderIncident = {
  id: string;
  name: string;
  protocol: string;
  status: string;
  healthStatus: string;
  lastHealthCheckAtUnixSeconds?: string;
  lastErrorAtUnixSeconds?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
};

export type OperationalActivity = {
  id: string;
  kind: "authorization" | "rejection" | "failure" | "settlement" | "distribution" | "recovery";
  status: string;
  taskId: string;
  taskName: string;
  providerId: string;
  providerName: string;
  protocol: string;
  network?: string;
  amountAtomic: string;
  timestampUnixSeconds: string;
};

export type OperationalDashboard = {
  generatedAtUnixSeconds: string;
  tasks: {
    total: number;
    active: number;
    completed: number;
    cancelled: number;
  };
  channels: {
    total: number;
    active: number;
    settlementHealthy: number;
    settlementPending: number;
    requiringAction: number;
    recoverable: number;
    failed: number;
  };
  providers: {
    total: number;
    healthy: number;
    unhealthy: number;
    unknown: number;
    disabled: number;
  };
  money: {
    authorizedAtomic: string;
    settledAtomic: string;
    recoveredAtomic: string;
    recoverableAtomic: string;
  };
  recentTasks: OperationalTaskSummary[];
  channelsRequiringAction: OperationalChannelAction[];
  providerIncidents: OperationalProviderIncident[];
  recentActivity: OperationalActivity[];
};

export type AnalyticsSeriesPoint = {
  bucketStartUnixSeconds: string;
  authorizedAtomic: string;
  settledAtomic: string;
  recoveredAtomic: string;
  failures: number;
};

export type AnalyticsMoneyBreakdown = {
  key: string;
  label: string;
  count: number;
  authorizedAtomic: string;
  settledAtomic: string;
  recoveredAtomic: string;
};

export type AnalyticsStatusBreakdown = {
  key: string;
  label: string;
  count: number;
};

export type OperationalAnalytics = {
  generatedAtUnixSeconds: string;
  range: OperationsAnalyticsRange;
  tasks: {
    total: number;
    active: number;
    completed: number;
    cancelled: number;
    successful: number;
    failed: number;
    budgetAtomic: string;
  };
  calls: {
    total: number;
    failed: number;
  };
  spend: {
    authorizedAtomic: string;
    settledAtomic: string;
    recoveredAtomic: string;
  };
  rates: {
    taskSuccessPercent: number;
    taskFailurePercent: number;
    callFailurePercent: number;
  };
  latency: {
    averageSettlementSeconds?: number;
    averageRecoverySeconds?: number;
  };
  series: AnalyticsSeriesPoint[];
  breakdowns: {
    tasks: AnalyticsMoneyBreakdown[];
    providers: AnalyticsMoneyBreakdown[];
    protocols: AnalyticsMoneyBreakdown[];
    networks: AnalyticsMoneyBreakdown[];
    statuses: AnalyticsStatusBreakdown[];
  };
};

const DAY = 86_400n;
const MAX_CUSTOM_RANGE = 366n * DAY;

function parseUnix(value: string | null, label: string): bigint {
  if (!value) throw new ApplicationError("VALIDATION_ERROR", `${label} is required for a custom analytics range.`, 400);
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    throw new ApplicationError("VALIDATION_ERROR", `${label} must be a non-negative Unix timestamp.`, 400);
  }
}

function customBucketSeconds(durationSeconds: bigint): number {
  if (durationSeconds <= 2n * DAY) return 3_600;
  if (durationSeconds <= 14n * DAY) return 21_600;
  if (durationSeconds <= 90n * DAY) return 86_400;
  return 604_800;
}

export function parseOperationsAnalyticsRange(
  url: URL,
  nowUnixSeconds = BigInt(Math.floor(Date.now() / 1000)),
): OperationsAnalyticsRangeQuery {
  const raw = url.searchParams.get("range") ?? "7d";
  if (!(analyticsRangePresets as readonly string[]).includes(raw)) {
    throw new ApplicationError("VALIDATION_ERROR", "Analytics range must be 24h, 7d, 30d, or custom.", 400);
  }
  const preset = raw as AnalyticsRangePreset;
  if (preset === "24h") {
    return { preset, fromUnixSeconds: nowUnixSeconds - DAY, toUnixSeconds: nowUnixSeconds, bucketSeconds: 3_600 };
  }
  if (preset === "7d") {
    return { preset, fromUnixSeconds: nowUnixSeconds - 7n * DAY, toUnixSeconds: nowUnixSeconds, bucketSeconds: 21_600 };
  }
  if (preset === "30d") {
    return { preset, fromUnixSeconds: nowUnixSeconds - 30n * DAY, toUnixSeconds: nowUnixSeconds, bucketSeconds: 86_400 };
  }

  const fromUnixSeconds = parseUnix(url.searchParams.get("from"), "from");
  const toUnixSeconds = parseUnix(url.searchParams.get("to"), "to");
  if (fromUnixSeconds >= toUnixSeconds) {
    throw new ApplicationError("VALIDATION_ERROR", "Custom analytics range must end after it starts.", 400);
  }
  if (toUnixSeconds > nowUnixSeconds + 300n) {
    throw new ApplicationError("VALIDATION_ERROR", "Custom analytics range cannot end in the future.", 400);
  }
  const duration = toUnixSeconds - fromUnixSeconds;
  if (duration > MAX_CUSTOM_RANGE) {
    throw new ApplicationError("VALIDATION_ERROR", "Custom analytics range cannot exceed 366 days.", 400);
  }
  if (duration < 60n) {
    throw new ApplicationError("VALIDATION_ERROR", "Custom analytics range must span at least one minute.", 400);
  }
  return {
    preset,
    fromUnixSeconds,
    toUnixSeconds,
    bucketSeconds: customBucketSeconds(duration),
  };
}
