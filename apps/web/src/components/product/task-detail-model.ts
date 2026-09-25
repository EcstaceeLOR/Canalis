export type TaskFlow = {
  id: string;
  taskId: string;
  providerId: string;
  requestId: string;
  status: "authorized" | "fulfilled" | "rejected" | "failed" | string;
  quotedAmountAtomic: string;
  previousCumulativeAtomic: string;
  nextCumulativeAtomic: string;
  rejectionCode?: string;
  rejectionMessage?: string;
  authorizationId?: string;
  paymentReference?: string;
  receipt?: {
    providerId: string;
    requestId: string;
    mint: string;
    priceAtomic: string;
    protocol: string;
    authorizationId: string;
    paymentReference?: string;
    responseHash: string;
    timestampUnixSeconds: string;
    protocolMetadata?: Record<string, string>;
  };
  errorMessage?: string;
  settlementTransactionSignature?: string;
  createdAtUnixSeconds: string;
};

export type TaskChannel = {
  providerId: string;
  programAddress: string;
  network: string;
  channelAddress?: string;
  status: string;
  ceilingAtomic: string;
  cumulativeAuthorizedAtomic: string;
  spentAtomic: string;
  openTransactionSignature?: string;
  settleTransactionSignature?: string;
  distributionTransactionSignature?: string;
  refundTransactionSignature?: string;
  recoveryState?: Record<string, unknown>;
};

export type TaskDetailPayload = {
  task: {
    id: string;
    owner: string;
    agentId: string;
    mode: string;
    status: string;
    mint: string;
    budgetAtomic: string;
    allowedProviders: string[];
    maxPerCallAtomic?: string;
    createdAtUnixSeconds: string;
    expiresAtUnixSeconds: string;
  };
  graph: {
    taskId: string;
    mint: string;
    budgetAtomic: string;
    spentAtomic: string;
    remainingAtomic: string;
    reservedCeilingAtomic: string;
    providers: Array<{
      providerId: string;
      channelCeilingAtomic: string;
      cumulativeAuthorizedAtomic: string;
      spentAtomic: string;
    }>;
    flows: TaskFlow[];
    settlements: Array<{
      providerId: string;
      cumulativeAmountAtomic: string;
      transactionSignature: string;
    }>;
  };
  channels: TaskChannel[];
  settlement: {
    status: "awaiting-onchain-finalization" | "partially-finalized" | "finalized" | string;
    authorizedSpendAtomic: string;
    recoverableAtomic: string;
    transactions: Array<{ providerId: string; transactionSignature: string }>;
  };
  workspace: {
    id: string;
    name: string;
    description: string;
    policyId: string;
    updatedAtUnixSeconds: string;
  } | null;
};

export type TimelineTone = "neutral" | "live" | "success" | "warning" | "danger";

export type TimelineEvent = {
  id: string;
  sequence: number;
  timestampUnixSeconds: string;
  providerId?: string;
  tone: TimelineTone;
  stage: "task" | "request" | "quote" | "policy" | "authorization" | "response" | "settlement" | "channel";
  title: string;
  detail: string;
  evidence?: {
    label: string;
    value: string;
    url?: string;
  };
};

const DEVNET_CAIP2 = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export function solanaExplorerTxUrl(signature?: string, network?: string) {
  if (!signature) return undefined;
  const suffix = network === DEVNET_CAIP2 || network?.toLowerCase().includes("devnet")
    ? "?cluster=devnet"
    : "";
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

export function solanaExplorerAddressUrl(address?: string, network?: string) {
  if (!address) return undefined;
  const suffix = network === DEVNET_CAIP2 || network?.toLowerCase().includes("devnet")
    ? "?cluster=devnet"
    : "";
  return `https://explorer.solana.com/address/${address}${suffix}`;
}

export function hasPartialFailure(payload: TaskDetailPayload) {
  return payload.task.status === "active" && payload.graph.flows.some((flow) =>
    flow.status === "failed" || flow.status === "rejected",
  );
}

export function isPollingStatus(status: string) {
  return status === "active";
}

function channelFor(payload: TaskDetailPayload, providerId: string) {
  return payload.channels.find((channel) => channel.providerId === providerId);
}

export function buildTaskTimeline(payload: TaskDetailPayload): TimelineEvent[] {
  let sequence = 0;
  const events: TimelineEvent[] = [];
  const add = (event: Omit<TimelineEvent, "sequence">) => {
    events.push({ ...event, sequence: sequence++ });
  };

  add({
    id: `${payload.task.id}:created`,
    timestampUnixSeconds: payload.task.createdAtUnixSeconds,
    tone: "neutral",
    stage: "task",
    title: "Task created",
    detail: `${payload.task.mode} task created with ${payload.task.allowedProviders.length} provider route${payload.task.allowedProviders.length === 1 ? "" : "s"}.`,
  });

  for (const flow of payload.graph.flows) {
    const channel = channelFor(payload, flow.providerId);
    add({
      id: `${flow.id}:request`,
      timestampUnixSeconds: flow.createdAtUnixSeconds,
      providerId: flow.providerId,
      tone: "neutral",
      stage: "request",
      title: "Provider request routed",
      detail: `Request ${flow.requestId} entered the ${flow.providerId} route.`,
    });
    add({
      id: `${flow.id}:quote`,
      timestampUnixSeconds: flow.createdAtUnixSeconds,
      providerId: flow.providerId,
      tone: "neutral",
      stage: "quote",
      title: "Quote evaluated",
      detail: `${flow.quotedAmountAtomic} atomic ${payload.task.mint} against the task and provider ceilings.`,
    });

    if (flow.status === "rejected") {
      add({
        id: `${flow.id}:rejected`,
        timestampUnixSeconds: flow.createdAtUnixSeconds,
        providerId: flow.providerId,
        tone: "warning",
        stage: "policy",
        title: "Policy rejected payment",
        detail: flow.rejectionMessage ?? flow.rejectionCode ?? "The payment did not satisfy task policy.",
        ...(flow.rejectionCode ? { evidence: { label: "Policy code", value: flow.rejectionCode } } : {}),
      });
      continue;
    }

    if (flow.authorizationId) {
      add({
        id: `${flow.id}:authorized`,
        timestampUnixSeconds: flow.createdAtUnixSeconds,
        providerId: flow.providerId,
        tone: "live",
        stage: "authorization",
        title: "Spend authorized",
        detail: `Cumulative authorization advanced from ${flow.previousCumulativeAtomic} to ${flow.nextCumulativeAtomic} atomic ${payload.task.mint}.`,
        evidence: { label: "Authorization", value: flow.authorizationId },
      });
    }

    if (flow.status === "failed") {
      add({
        id: `${flow.id}:failed`,
        timestampUnixSeconds: flow.createdAtUnixSeconds,
        providerId: flow.providerId,
        tone: "danger",
        stage: "response",
        title: "Provider execution failed",
        detail: flow.errorMessage ?? "The provider call failed after routing.",
      });
    }

    if (flow.receipt) {
      add({
        id: `${flow.id}:receipt`,
        timestampUnixSeconds: flow.receipt.timestampUnixSeconds,
        providerId: flow.providerId,
        tone: "success",
        stage: "response",
        title: "Response receipt stored",
        detail: `${flow.receipt.protocol} receipt persisted for ${flow.receipt.priceAtomic} atomic ${flow.receipt.mint}.`,
        evidence: { label: "Response hash", value: flow.receipt.responseHash },
      });
    }

    if (flow.settlementTransactionSignature) {
      add({
        id: `${flow.id}:settlement`,
        timestampUnixSeconds: payload.workspace?.updatedAtUnixSeconds ?? flow.createdAtUnixSeconds,
        providerId: flow.providerId,
        tone: "success",
        stage: "settlement",
        title: "Settlement transaction recorded",
        detail: "Canalis persisted real Solana settlement evidence for this flow.",
        evidence: {
          label: "Transaction",
          value: flow.settlementTransactionSignature,
          url: solanaExplorerTxUrl(flow.settlementTransactionSignature, channel?.network),
        },
      });
    }
  }

  for (const channel of payload.channels) {
    const timestamp = payload.workspace?.updatedAtUnixSeconds ?? payload.task.createdAtUnixSeconds;
    if (channel.openTransactionSignature) {
      add({
        id: `${channel.providerId}:channel-open`,
        timestampUnixSeconds: timestamp,
        providerId: channel.providerId,
        tone: "live",
        stage: "channel",
        title: "Payment channel opened",
        detail: `Channel ${channel.status} with a ceiling of ${channel.ceilingAtomic} atomic ${payload.task.mint}.`,
        evidence: {
          label: "Open transaction",
          value: channel.openTransactionSignature,
          url: solanaExplorerTxUrl(channel.openTransactionSignature, channel.network),
        },
      });
    }

    const terminalSignature = channel.refundTransactionSignature ?? channel.distributionTransactionSignature ?? channel.settleTransactionSignature;
    if (terminalSignature) {
      add({
        id: `${channel.providerId}:channel-terminal`,
        timestampUnixSeconds: timestamp,
        providerId: channel.providerId,
        tone: channel.status === "failed" ? "danger" : "success",
        stage: "settlement",
        title: `Channel ${channel.status}`,
        detail: `Persisted terminal evidence for the ${channel.providerId} channel.`,
        evidence: {
          label: "Transaction",
          value: terminalSignature,
          url: solanaExplorerTxUrl(terminalSignature, channel.network),
        },
      });
    }
  }

  if (payload.task.status !== "active" && payload.task.status !== "draft") {
    add({
      id: `${payload.task.id}:status:${payload.task.status}`,
      timestampUnixSeconds: payload.workspace?.updatedAtUnixSeconds ?? payload.task.createdAtUnixSeconds,
      tone: payload.task.status === "completed" ? "success" : payload.task.status === "cancelled" ? "warning" : "neutral",
      stage: "task",
      title: `Task ${payload.task.status}`,
      detail: payload.task.status === "completed"
        ? "Execution history is durable and ready for settlement inspection."
        : "The task lifecycle state was persisted without deleting its payment history.",
    });
  }

  return events.sort((a, b) => {
    const time = Number(a.timestampUnixSeconds) - Number(b.timestampUnixSeconds);
    return time || a.sequence - b.sequence;
  });
}
