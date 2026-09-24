"use client";

import { useMemo, useState } from "react";
import { formatUsdcAtomic } from "../lib/money";

type ProviderId = "search" | "data" | "inference";

type ReceiptDto = {
  providerId: string;
  requestId: string;
  mint: string;
  priceAtomic: string;
  protocol: string;
  authorizationId: string;
  paymentReference?: string;
  responseHash: string;
  timestampUnixSeconds: string;
};

type FlowDto = {
  id: string;
  taskId: string;
  providerId: string;
  requestId: string;
  status: "authorized" | "fulfilled" | "rejected" | "failed";
  quotedAmountAtomic: string;
  previousCumulativeAtomic: string;
  nextCumulativeAtomic: string;
  rejectionCode?: string;
  rejectionMessage?: string;
  authorizationId?: string;
  paymentReference?: string;
  receipt?: ReceiptDto;
  errorMessage?: string;
  settlementTransactionSignature?: string;
  createdAtUnixSeconds: string;
};

type ProviderStateDto = {
  providerId: string;
  channelCeilingAtomic: string;
  cumulativeAuthorizedAtomic: string;
  spentAtomic: string;
};

type DemoResponse = {
  task: {
    id: string;
    owner: string;
    agentId: string;
    allowedProviders: ProviderId[];
    maxPerCallAtomic: string;
  };
  graph: {
    taskId: string;
    mint: string;
    budgetAtomic: string;
    spentAtomic: string;
    remainingAtomic: string;
    reservedCeilingAtomic: string;
    providers: ProviderStateDto[];
    flows: FlowDto[];
    settlements: Array<{
      providerId: string;
      cumulativeAmountAtomic: string;
      transactionSignature: string;
    }>;
  };
  settlement: {
    status: "awaiting-onchain-finalization";
    authorizedSpendAtomic: string;
    recoverableAtomic: string;
    transactions: Array<{
      providerId: string;
      cumulativeAmountAtomic: string;
      transactionSignature: string;
    }>;
  };
};

type WalletProvider = {
  connect(): Promise<{ publicKey: { toString(): string } }>;
};

declare global {
  interface Window {
    solana?: WalletProvider;
  }
}

const providerInfo: Record<
  ProviderId,
  { name: string; price: string; glyph: string; description: string }
> = {
  search: {
    name: "Search",
    price: "$0.05",
    glyph: "S",
    description: "Purchases external evidence for the task.",
  },
  data: {
    name: "Data",
    price: "$0.03",
    glyph: "D",
    description: "Purchases a structured data lookup.",
  },
  inference: {
    name: "Inference",
    price: "$0.12",
    glyph: "I",
    description: "Purchases synthesis of the gathered evidence.",
  },
};

function usd(atomic: string): string {
  return `$${formatUsdcAtomic(BigInt(atomic), 2)}`;
}

function short(value: string, left = 7, right = 5): string {
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Home() {
  const [wallet, setWallet] = useState<string>("");
  const [budget, setBudget] = useState("1.00");
  const [perCallCap, setPerCallCap] = useState("0.25");
  const [allowedProviders, setAllowedProviders] = useState<ProviderId[]>([
    "search",
    "data",
    "inference",
  ]);
  const [runState, setRunState] = useState<"idle" | "running" | "complete">(
    "idle",
  );
  const [response, setResponse] = useState<DemoResponse | null>(null);
  const [visibleFlowCount, setVisibleFlowCount] = useState(0);
  const [selectedFlowId, setSelectedFlowId] = useState<string>("");
  const [error, setError] = useState("");

  const visibleFlows = response?.graph.flows.slice(0, visibleFlowCount) ?? [];
  const selectedFlow =
    visibleFlows.find((flow) => flow.id === selectedFlowId) ??
    visibleFlows.at(-1) ??
    null;

  const progress = useMemo(() => {
    if (!response) return 0;
    const budgetAtomic = BigInt(response.graph.budgetAtomic);
    if (budgetAtomic === 0n) return 0;
    return Number((BigInt(response.graph.spentAtomic) * 10_000n) / budgetAtomic) / 100;
  }, [response]);

  async function connectWallet() {
    setError("");
    try {
      if (!window.solana) {
        throw new Error(
          "No injected Solana wallet was detected. You can still run the deterministic demo.",
        );
      }
      const result = await window.solana.connect();
      setWallet(result.publicKey.toString());
    } catch (walletError) {
      setError(
        walletError instanceof Error
          ? walletError.message
          : "Unable to connect wallet.",
      );
    }
  }

  function toggleProvider(providerId: ProviderId) {
    setAllowedProviders((current) => {
      if (current.includes(providerId)) {
        if (current.length === 1) return current;
        return current.filter((value) => value !== providerId);
      }
      return [...current, providerId];
    });
  }

  async function runTask() {
    setError("");
    setResponse(null);
    setVisibleFlowCount(0);
    setSelectedFlowId("");
    setRunState("running");

    try {
      const request = await fetch("/api/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: wallet || "demo-owner",
          budgetUsd: budget,
          maxPerCallUsd: perCallCap,
          allowedProviders,
        }),
      });
      const payload = (await request.json()) as DemoResponse | { error: string };
      if (!request.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Unable to run Canalis task.",
        );
      }

      setResponse(payload);
      for (let index = 1; index <= payload.graph.flows.length; index += 1) {
        await delay(520);
        setVisibleFlowCount(index);
      }
      setRunState("complete");
    } catch (runError) {
      setRunState("idle");
      setError(
        runError instanceof Error ? runError.message : "Unable to run task.",
      );
    }
  }

  return (
    <main className="site-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <nav className="nav container">
        <a className="brand" href="#top" aria-label="Canalis home">
          <span className="brand-mark">C</span>
          <span>CANALIS</span>
        </a>
        <div className="nav-center">
          <span>Solana</span>
          <span className="nav-dot" />
          <span>Payment channels</span>
          <span className="nav-dot" />
          <span>Autonomous commerce</span>
        </div>
        <button className="wallet-button" onClick={connectWallet} type="button">
          <span className={`wallet-pulse ${wallet ? "connected" : ""}`} />
          {wallet ? short(wallet) : "Connect wallet"}
        </button>
      </nav>

      <section className="hero container" id="top">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            Built for autonomous agents on Solana
          </div>
          <h1>
            Give agents autonomy.
            <br />
            <span>Keep money governed.</span>
          </h1>
          <p className="hero-lede">
            Canalis turns one approved task budget into controlled payments across
            many machine services—then shows exactly where every unit went.
          </p>
          <div className="hero-proof">
            <div>
              <strong>Bounded</strong>
              <span>Hard task & provider caps</span>
            </div>
            <div>
              <strong>Offchain-fast</strong>
              <span>Cumulative payment vouchers</span>
            </div>
            <div>
              <strong>Verifiable</strong>
              <span>Receipts → settlement</span>
            </div>
          </div>
        </div>

        <aside className="composer-card">
          <div className="card-kicker">New autonomous task</div>
          <h2>Fund the outcome, not a wallet.</h2>
          <p>
            Set the ceiling. Choose who the agent may pay. Canalis enforces the
            policy before paid work is returned.
          </p>

          <div className="money-grid">
            <label>
              <span>Task budget</span>
              <div className="money-input">
                <span>$</span>
                <input
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                  inputMode="decimal"
                  aria-label="Task budget in USDC"
                />
                <em>USDC</em>
              </div>
            </label>
            <label>
              <span>Max / call</span>
              <div className="money-input">
                <span>$</span>
                <input
                  value={perCallCap}
                  onChange={(event) => setPerCallCap(event.target.value)}
                  inputMode="decimal"
                  aria-label="Maximum amount per service call"
                />
                <em>USDC</em>
              </div>
            </label>
          </div>

          <div className="allowlist-head">
            <span>Provider allowlist</span>
            <small>{allowedProviders.length} approved</small>
          </div>
          <div className="provider-picker">
            {(Object.keys(providerInfo) as ProviderId[]).map((providerId) => {
              const provider = providerInfo[providerId];
              const active = allowedProviders.includes(providerId);
              return (
                <button
                  className={`provider-toggle ${active ? "active" : ""}`}
                  key={providerId}
                  onClick={() => toggleProvider(providerId)}
                  type="button"
                  aria-pressed={active}
                >
                  <span className="provider-glyph">{provider.glyph}</span>
                  <span>
                    <strong>{provider.name}</strong>
                    <small>{provider.price} / call</small>
                  </span>
                  <span className="toggle-check">{active ? "✓" : "+"}</span>
                </button>
              );
            })}
          </div>

          <button
            className="run-button"
            disabled={runState === "running"}
            onClick={runTask}
            type="button"
          >
            <span>{runState === "running" ? "Routing payments…" : "Run autonomous task"}</span>
            <span className="run-arrow">→</span>
          </button>
          <div className="composer-foot">
            <span>Demo uses deterministic services</span>
            <span>No private keys handled</span>
          </div>
        </aside>
      </section>

      {error ? (
        <div className="container error-banner" role="alert">
          <span>!</span>
          {error}
        </div>
      ) : null}

      <section className="workspace container" id="workspace">
        <div className="section-heading">
          <div>
            <div className="eyebrow muted">Live control plane</div>
            <h2>One task. Many payment routes.</h2>
          </div>
          <div className={`run-status ${runState}`}>
            <span />
            {runState === "idle"
              ? "Ready"
              : runState === "running"
                ? "Agent working"
                : "Task complete"}
          </div>
        </div>

        <div className="metric-grid">
          <Metric
            label="Approved budget"
            value={response ? usd(response.graph.budgetAtomic) : `$${budget}`}
            meta="Hard task ceiling"
          />
          <Metric
            label="Actually authorized"
            value={response ? usd(response.graph.spentAtomic) : "$0.00"}
            meta={response ? `${progress.toFixed(0)}% of budget` : "No spend yet"}
          />
          <Metric
            label="Recoverable"
            value={response ? usd(response.graph.remainingAtomic) : `$${budget}`}
            meta="Unused capacity"
          />
          <Metric
            label="Per-call limit"
            value={response ? usd(response.task.maxPerCallAtomic) : `$${perCallCap}`}
            meta="Policy enforced pre-payment"
          />
        </div>

        <div className="spend-bar-shell">
          <div className="spend-bar-labels">
            <span>Task utilization</span>
            <span>{progress.toFixed(1)}%</span>
          </div>
          <div className="spend-bar">
            <div style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        </div>

        <div className="graph-panel">
          <div className="graph-origin">
            <div className="agent-orb">A</div>
            <div>
              <small>CANALIS AGENT</small>
              <strong>{response?.task.agentId ?? "canalis-research-agent"}</strong>
              <span>{wallet ? short(wallet) : "demo-owner"}</span>
            </div>
          </div>

          <div className="route-lines" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>

          <div className="graph-providers">
            {(Object.keys(providerInfo) as ProviderId[])
              .filter((providerId) => allowedProviders.includes(providerId))
              .map((providerId) => {
                const provider = providerInfo[providerId];
                const state = response?.graph.providers.find(
                  (entry) => entry.providerId === providerId,
                );
                const flow = visibleFlows.find(
                  (entry) => entry.providerId === providerId,
                );
                return (
                  <button
                    className={`graph-provider ${flow?.status ?? "waiting"}`}
                    key={providerId}
                    onClick={() => flow && setSelectedFlowId(flow.id)}
                    type="button"
                  >
                    <span className="provider-glyph large">{provider.glyph}</span>
                    <span className="graph-provider-copy">
                      <small>{provider.name}</small>
                      <strong>
                        {state ? usd(state.spentAtomic) : provider.price}
                      </strong>
                      <em>
                        {flow
                          ? flow.status === "rejected"
                            ? "Blocked by policy"
                            : "Receipt captured"
                          : runState === "running"
                            ? "Waiting for route"
                            : "Ready"}
                      </em>
                    </span>
                    <span className="flow-status-dot" />
                  </button>
                );
              })}
          </div>
        </div>

        <div className="detail-grid">
          <div className="flow-list panel">
            <div className="panel-head">
              <div>
                <small>PAYMENT GRAPH</small>
                <h3>Task flows</h3>
              </div>
              <span>{visibleFlows.length} / {response?.graph.flows.length ?? allowedProviders.length}</span>
            </div>

            {visibleFlows.length === 0 ? (
              <div className="empty-state">
                <span className="empty-pulse" />
                <strong>No payments yet</strong>
                <p>Run the task to watch Canalis authorize provider spend.</p>
              </div>
            ) : (
              <div className="flow-rows">
                {visibleFlows.map((flow, index) => (
                  <button
                    className={`flow-row ${selectedFlow?.id === flow.id ? "selected" : ""}`}
                    key={flow.id}
                    onClick={() => setSelectedFlowId(flow.id)}
                    type="button"
                  >
                    <span className="flow-index">0{index + 1}</span>
                    <span className="flow-main">
                      <strong>{providerInfo[flow.providerId as ProviderId]?.name ?? flow.providerId}</strong>
                      <small>{flow.requestId}</small>
                    </span>
                    <span className={`status-pill ${flow.status}`}>{flow.status}</span>
                    <span className="flow-price">{usd(flow.quotedAmountAtomic)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="inspector panel">
            <div className="panel-head">
              <div>
                <small>FLOW INSPECTOR</small>
                <h3>{selectedFlow ? "Authorization proof" : "Select a flow"}</h3>
              </div>
              {selectedFlow ? (
                <span className={`status-pill ${selectedFlow.status}`}>
                  {selectedFlow.status}
                </span>
              ) : null}
            </div>

            {selectedFlow ? (
              <div className="inspect-body">
                <InspectRow label="Provider" value={selectedFlow.providerId} />
                <InspectRow label="Quoted price" value={usd(selectedFlow.quotedAmountAtomic)} />
                <InspectRow
                  label="Cumulative authorization"
                  value={usd(selectedFlow.nextCumulativeAtomic)}
                />
                {selectedFlow.rejectionCode ? (
                  <div className="policy-rejection">
                    <small>{selectedFlow.rejectionCode}</small>
                    <p>{selectedFlow.rejectionMessage}</p>
                  </div>
                ) : (
                  <>
                    <InspectRow
                      label="Payment reference"
                      value={short(selectedFlow.paymentReference ?? "pending", 20, 8)}
                    />
                    <InspectRow
                      label="Response hash"
                      value={short(selectedFlow.receipt?.responseHash ?? "pending", 18, 10)}
                    />
                  </>
                )}
              </div>
            ) : (
              <div className="empty-state compact">
                <strong>Every payment explains itself.</strong>
                <p>
                  Click a flow to inspect price, policy decision, cumulative
                  authorization, and receipt hash.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="settlement-panel">
          <div className="settlement-copy">
            <div className="settlement-icon">↯</div>
            <div>
              <small>SETTLEMENT & RECOVERY</small>
              <h3>
                {response
                  ? `${usd(response.settlement.authorizedSpendAtomic)} consumed · ${usd(response.settlement.recoverableAtomic)} recoverable`
                  : "Settlement appears here after the task"}
              </h3>
              <p>
                The deterministic UI does not invent blockchain transactions.
                When the on-chain finalizer runs, each provider settlement will
                surface here with its Solana transaction signature.
              </p>
            </div>
          </div>
          <div className="settlement-actions">
            {response?.settlement.transactions.length ? (
              response.settlement.transactions.map((transaction) => (
                <a
                  href={`https://explorer.solana.com/tx/${transaction.transactionSignature}?cluster=devnet`}
                  key={transaction.transactionSignature}
                  rel="noreferrer"
                  target="_blank"
                >
                  {transaction.providerId} ↗
                </a>
              ))
            ) : (
              <span className="pending-settlement">Awaiting on-chain finalization</span>
            )}
          </div>
        </div>
      </section>

      <footer className="footer container">
        <div className="brand small">
          <span className="brand-mark">C</span>
          <span>CANALIS</span>
        </div>
        <p>Give an agent a budget. Canalis handles everything it pays for.</p>
        <span>Crypto World&apos;s Fair · Solana track</span>
      </footer>
    </main>
  );
}

function Metric({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </div>
  );
}

function InspectRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspect-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
