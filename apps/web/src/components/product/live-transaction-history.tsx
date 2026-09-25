"use client";

import { useCallback, useEffect, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";
import {
  solanaExplorerTxUrl,
  type TaskDetailPayload,
} from "./task-detail-model";

type TaskSummary = {
  id: string;
  mode: string;
  updatedAtUnixSeconds: string;
};

type TaskListResponse = {
  tasks: TaskSummary[];
};

type LiveTransaction = {
  key: string;
  taskId: string;
  providerId: string;
  event: "Channel open" | "Finalization";
  amountAtomic: string;
  network: string;
  signature: string;
  status: string;
};

function usd(atomic: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(Number(atomic) / 1_000_000);
}

function short(value: string, head = 9, tail = 7) {
  return value.length <= head + tail + 1
    ? value
    : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

async function responseMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

function transactionsFromTask(task: TaskDetailPayload): LiveTransaction[] {
  const rows: LiveTransaction[] = [];

  for (const channel of task.channels) {
    if (channel.openTransactionSignature) {
      rows.push({
        key: `${task.task.id}:${channel.providerId}:open:${channel.openTransactionSignature}`,
        taskId: task.task.id,
        providerId: channel.providerId,
        event: "Channel open",
        amountAtomic: channel.ceilingAtomic,
        network: channel.network,
        signature: channel.openTransactionSignature,
        status: channel.status === "reserved" ? "Pending" : "Confirmed",
      });
    }

    const terminalSignature =
      channel.distributionTransactionSignature ??
      channel.refundTransactionSignature ??
      channel.settleTransactionSignature;
    if (terminalSignature) {
      rows.push({
        key: `${task.task.id}:${channel.providerId}:final:${terminalSignature}`,
        taskId: task.task.id,
        providerId: channel.providerId,
        event: "Finalization",
        amountAtomic: channel.cumulativeAuthorizedAtomic,
        network: channel.network,
        signature: terminalSignature,
        status: ["distributed", "recovered"].includes(channel.status)
          ? "Confirmed"
          : channel.status,
      });
    }
  }

  return rows;
}

export function LiveTransactionHistory() {
  const { session, status: walletStatus } = useWalletIdentity();
  const [rows, setRows] = useState<LiveTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session) {
      setRows([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const listResponse = await fetch(
        "/api/tasks?page=1&pageSize=50&sort=updated_desc",
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!listResponse.ok) throw new Error(await responseMessage(listResponse));
      const taskList = (await listResponse.json()) as TaskListResponse;
      const liveTasks = taskList.tasks
        .filter((task) => task.mode === "x402")
        .slice(0, 12);

      const details = await Promise.all(
        liveTasks.map(async (task) => {
          const response = await fetch(`/api/tasks/${task.id}`, {
            credentials: "same-origin",
            cache: "no-store",
          });
          if (!response.ok) throw new Error(await responseMessage(response));
          return (await response.json()) as TaskDetailPayload;
        }),
      );

      setRows(details.flatMap(transactionsFromTask));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load live transaction evidence.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) {
    return (
      <section className="empty-workspace compact">
        <div className="empty-symbol">◎</div>
        <div>
          <h2>Connect your wallet to view live transaction evidence</h2>
          <p>
            {walletStatus === "loading"
              ? "Checking your existing wallet session…"
              : "Wallet-owned channel opens and finalization transactions appear here once they are persisted by Canalis."}
          </p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="empty-workspace compact">
        <div className="empty-symbol">!</div>
        <div><h2>Could not load live transactions</h2><p>{error}</p></div>
        <button type="button" onClick={() => void load()}>Retry</button>
      </section>
    );
  }

  if (loading && rows.length === 0) {
    return <section className="empty-workspace compact"><div><h2>Loading live transaction evidence…</h2></div></section>;
  }

  if (rows.length === 0) {
    return (
      <section className="empty-workspace compact">
        <div className="empty-symbol">≡</div>
        <div>
          <h2>No wallet-owned live channel transactions yet</h2>
          <p>Create an x402 devnet task, open its channels, run it, and finalize it to populate this view.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="product-card table-card">
      <div className="section-heading">
        <div><h2>Wallet-owned live transactions</h2><p>Persisted Solana devnet evidence from your Canalis tasks.</p></div>
        {loading ? <span>Refreshing…</span> : null}
      </div>
      <div className="responsive-table transactions-table">
        <div className="table-head"><span>Event</span><span>Amount</span><span>Provider</span><span>Status</span><span>Signature</span></div>
        {rows.map((row) => {
          const url = solanaExplorerTxUrl(row.signature, row.network);
          const content = <>
            <div><span className="table-primary">{row.event}</span><small>{short(row.taskId, 8, 6)}</small></div>
            <span>{usd(row.amountAtomic)}</span>
            <span>{row.providerId}</span>
            <span><i className="status-dot ready" />{row.status}</span>
            <b>{short(row.signature)} ↗</b>
          </>;
          return url
            ? <a className="table-row" href={url} target="_blank" rel="noreferrer" key={row.key}>{content}</a>
            : <div className="table-row" key={row.key}>{content}</div>;
        })}
      </div>
    </section>
  );
}
