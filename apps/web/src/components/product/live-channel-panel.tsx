"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PaymentRequired } from "@x402/core/types";
import { useWalletIdentity } from "../wallet/wallet-identity";
import { createLiveX402PaymentPayload } from "../../lib/live-x402-wallet";
import {
  solanaExplorerAddressUrl,
  solanaExplorerTxUrl,
  type TaskChannel,
  type TaskDetailPayload,
} from "./task-detail-model";
import styles from "./live-channel-panel.module.css";

function usd(value: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(value) / 1_000_000);
}

async function responseMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

function preparedRequirement(channel: TaskChannel): PaymentRequired | null {
  const value = channel.recoveryState?.paymentRequired as PaymentRequired | undefined;
  return value?.x402Version === 2 && value.accepts?.[0] ? value : null;
}

export function LiveChannelPanel({ taskId }: { taskId: string }) {
  const { session } = useWalletIdentity();
  const [payload, setPayload] = useState<TaskDetailPayload | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    const response = await fetch(`/api/tasks/${taskId}`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(await responseMessage(response));
    setPayload((await response.json()) as TaskDetailPayload);
  }, [session, taskId]);

  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load live channels.")); }, [load]);
  useEffect(() => {
    if (!session || payload?.task.mode !== "x402" || payload.settlement.status === "finalized") return;
    const timer = window.setInterval(() => void load().catch(() => undefined), 4_000);
    return () => window.clearInterval(timer);
  }, [load, payload, session]);

  const channelsReady = useMemo(() => payload?.channels.every((channel) => ["open", "distributed", "recovered"].includes(channel.status)) ?? false, [payload]);
  const hasPrepared = payload?.channels.some((channel) => channel.status === "reserved" && preparedRequirement(channel)) ?? false;
  const needsPrepare = payload?.channels.some((channel) => channel.status === "reserved" && !preparedRequirement(channel)) ?? false;
  const canFinalize = payload?.task.mode === "x402" && payload.graph.flows.length > 0 && payload.channels.some((channel) => ["open", "failed"].includes(channel.status));

  if (!session || !payload || payload.task.mode !== "x402") return null;
  const walletAddress = session.walletAddress;

  async function prepare() {
    setBusy("prepare"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/live/prepare`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseMessage(response));
      setNotice("Sandbox test tokens funded and channel requirements pinned. Sign each prepared channel with your wallet.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not prepare live channels."); }
    finally { setBusy(""); }
  }

  async function open(channel: TaskChannel) {
    const paymentRequired = preparedRequirement(channel);
    if (!paymentRequired) return;
    setBusy(`open:${channel.providerId}`); setError(""); setNotice("");
    try {
      const paymentPayload = await createLiveX402PaymentPayload(walletAddress, paymentRequired);
      const response = await fetch(`/api/tasks/${taskId}/live/channels/${channel.providerId}/deposit`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentPayload }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setNotice(`${channel.providerId} channel opened on Solana devnet.`);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : `Could not open ${channel.providerId} channel.`); }
    finally { setBusy(""); }
  }

  async function finalize() {
    setBusy("finalize"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/live/finalize`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = (await response.json()) as { partial?: boolean };
      setNotice(result.partial ? "Some channels require reconciliation. Automatic terminal rebroadcast is blocked until their persisted state is reviewed." : "All provider channels finalized and unused budget returned on-chain.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not finalize live channels." ); }
    finally { setBusy(""); }
  }

  return (
    <section className={styles.panel} aria-label="Live Solana payment channels">
      <div className={styles.head}>
        <div><span>Live Solana devnet</span><h2>Wallet-signed payment channels</h2><p>Open the reserved x402 channels, run the governed task, then settle each provider&apos;s cumulative usage. Unused channel ceilings are returned in the same terminal transaction.</p></div>
        <div className={styles.actions}>
          {needsPrepare ? <button disabled={Boolean(busy)} onClick={() => void prepare()}>{busy === "prepare" ? "Preparing…" : "1 · Fund & prepare"}</button> : null}
          {channelsReady && payload.graph.flows.length === 0 ? <button disabled>2 · Channels ready — run task below</button> : null}
          {canFinalize ? <button disabled={Boolean(busy)} onClick={() => void finalize()}>{busy === "finalize" ? "Finalizing…" : "3 · Finalize on-chain"}</button> : null}
        </div>
      </div>
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {hasPrepared ? <div className={styles.step}>Prepared channels require one wallet transaction signature each. The sponsor pays devnet transaction fees; your wallet authorizes only the bounded test-token deposit.</div> : null}
      <div className={styles.channels}>
        {payload.channels.map((channel) => {
          const requirement = preparedRequirement(channel);
          const channelUrl = solanaExplorerAddressUrl(channel.channelAddress, channel.network);
          const openUrl = solanaExplorerTxUrl(channel.openTransactionSignature, channel.network);
          const terminal = channel.refundTransactionSignature ?? channel.distributionTransactionSignature ?? channel.settleTransactionSignature;
          const terminalUrl = solanaExplorerTxUrl(terminal, channel.network);
          return <article className={styles.channel} key={channel.providerId}>
            <header><strong>{channel.providerId}</strong><span className={styles.status}>{channel.status}</span></header>
            <div className={styles.numbers}><div><span>Ceiling</span><strong>{usd(channel.ceilingAtomic)}</strong></div><div><span>Authorized</span><strong>{usd(channel.cumulativeAuthorizedAtomic)}</strong></div></div>
            {channel.status === "reserved" && requirement ? <button disabled={Boolean(busy)} onClick={() => void open(channel)}>{busy === `open:${channel.providerId}` ? "Sign in wallet…" : "Open real devnet channel"}</button> : null}
            <div className={styles.evidence}>
              {channelUrl ? <a href={channelUrl} target="_blank" rel="noreferrer">Channel account ↗</a> : <span>Channel account pending</span>}
              {openUrl ? <a href={openUrl} target="_blank" rel="noreferrer">Open transaction ↗</a> : null}
              {terminalUrl ? <a href={terminalUrl} target="_blank" rel="noreferrer">Finalization transaction ↗</a> : null}
              {channel.status === "failed" ? <span>Recovery state: {String(channel.recoveryState?.error ?? "reconciliation required; automatic rebroadcast blocked")}</span> : null}
            </div>
          </article>;
        })}
      </div>
    </section>
  );
}
