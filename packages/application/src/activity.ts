import type { ApplicationErrorCode } from "./errors.js";

export const activityCategories = ["task", "provider", "channel", "settlement", "recovery", "integration"] as const;
export type ActivityCategory = (typeof activityCategories)[number];

export const activitySeverities = ["info", "success", "warning", "critical"] as const;
export type ActivitySeverity = (typeof activitySeverities)[number];

export type ActivityState = "open" | "resolved";
export type ActivityActionKind =
  | "open-task"
  | "retest-provider"
  | "finalize-channel"
  | "recover-channel"
  | "inspect-channel"
  | "open-transaction"
  | "none";

export type ActivityRecord = {
  id: string;
  fingerprint: string;
  sourceVersion: string;
  category: ActivityCategory;
  severity: ActivitySeverity;
  state: ActivityState;
  title: string;
  message: string;
  guidance?: string;
  errorCode?: string;
  taskId?: string;
  providerId?: string;
  channelAddress?: string;
  transactionSignature?: string;
  actionKind: ActivityActionKind;
  actionLabel?: string;
  actionHref?: string;
  occurrenceCount: number;
  read: boolean;
  firstSeenAtUnixSeconds: string;
  lastSeenAtUnixSeconds: string;
  resolvedAtUnixSeconds?: string;
};

export type ActivityListQuery = {
  categories?: ActivityCategory[];
  severities?: ActivitySeverity[];
  state?: ActivityState;
  unreadOnly?: boolean;
  page: number;
  pageSize: number;
};

export type ActivityListResult = {
  events: ActivityRecord[];
  total: number;
  unreadCount: number;
  openCount: number;
  criticalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export function parseActivityListQuery(url: URL): ActivityListQuery {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));
  const categories = (url.searchParams.get("category") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is ActivityCategory => (activityCategories as readonly string[]).includes(value));
  const severities = (url.searchParams.get("severity") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is ActivitySeverity => (activitySeverities as readonly string[]).includes(value));
  const rawState = url.searchParams.get("state");
  const state = rawState === "open" || rawState === "resolved" ? rawState : undefined;
  return {
    ...(categories.length ? { categories } : {}),
    ...(severities.length ? { severities } : {}),
    ...(state ? { state } : {}),
    unreadOnly: url.searchParams.get("unread") === "1",
    page,
    pageSize,
  };
}

export type ProductErrorDescriptor = {
  title: string;
  message: string;
  guidance: string;
  severity: ActivitySeverity;
};

const descriptors: Partial<Record<ApplicationErrorCode, ProductErrorDescriptor>> = {
  PROVIDER_UNHEALTHY: {
    title: "Provider needs attention",
    message: "A configured provider did not pass its latest health check.",
    guidance: "Retest the provider before allowing new tasks to depend on it.",
    severity: "warning",
  },
  PROVIDER_RUNTIME_NOT_CONNECTED: {
    title: "Provider runtime is not connected",
    message: "The provider is configured, but this deployment cannot execute it with a non-custodial runtime yet.",
    guidance: "Use a runtime-ready provider or keep the task as a draft until the signer/session runtime is connected.",
    severity: "warning",
  },
  PROVIDER_EXECUTION_FAILED: {
    title: "Provider call failed",
    message: "A provider request did not complete successfully.",
    guidance: "Check provider health and the affected task before retrying the workload.",
    severity: "warning",
  },
  INTEGRATION_CONNECTION_FAILED: {
    title: "Integration connection failed",
    message: "Canalis could not verify the provider integration safely.",
    guidance: "Retest the endpoint and confirm its network, asset, and credentials before enabling it.",
    severity: "warning",
  },
  CHANNEL_RECOVERY_REQUIRED: {
    title: "Channel requires reconciliation",
    message: "Canalis cannot safely rebroadcast a terminal channel action until the current on-chain state is inspected.",
    guidance: "Inspect the channel and its Explorer evidence before taking another terminal action.",
    severity: "critical",
  },
  CHANNEL_FINALIZATION_AMBIGUOUS: {
    title: "Settlement confirmation is ambiguous",
    message: "A terminal transaction may have reached Solana, but Canalis could not confirm the outcome safely.",
    guidance: "Do not retry automatically. Inspect the channel and reconcile the transaction evidence first.",
    severity: "critical",
  },
  CHANNEL_NETWORK_MISMATCH: {
    title: "Channel network mismatch",
    message: "The requested channel action does not match the active Solana environment.",
    guidance: "Switch to the channel's configured network before attempting the action again.",
    severity: "warning",
  },
  MAINNET_RUNTIME_NOT_CONFIGURED: {
    title: "Mainnet runtime is not configured",
    message: "The workspace is configured for mainnet, but live mainnet execution is intentionally blocked.",
    guidance: "Connect a mainnet-capable non-custodial signer/runtime before enabling live execution.",
    severity: "warning",
  },
  TASK_NETWORK_MISMATCH: {
    title: "Task network does not match workspace settings",
    message: "The task configuration conflicts with the workspace's active Solana network.",
    guidance: "Align the task policy and workspace network before creating or executing the task.",
    severity: "warning",
  },
  TASK_ASSET_MISMATCH: {
    title: "Task asset does not match workspace settings",
    message: "The task configuration conflicts with the workspace's configured payment asset.",
    guidance: "Use an allowed asset or update the workspace and policy configuration first.",
    severity: "warning",
  },
};

export function productErrorDescriptor(code: string | undefined): ProductErrorDescriptor {
  if (code && code in descriptors) return descriptors[code as ApplicationErrorCode]!;
  return {
    title: "Canalis needs attention",
    message: "The operation did not complete successfully.",
    guidance: "Open the affected record and review its current state before retrying.",
    severity: "warning",
  };
}
