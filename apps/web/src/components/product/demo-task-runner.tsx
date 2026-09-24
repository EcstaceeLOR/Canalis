"use client";

import { useMemo, useState } from "react";

type ProviderId = "search" | "data" | "inference";
type Flow = { id: string; providerId: string; requestId: string; status: "fulfilled" | "rejected"; quotedAmountAtomic: string; nextCumulativeAtomic: string; rejectionCode?: string; rejectionMessage?: string; paymentReference?: string; receipt?: { responseHash: string } };
type DemoResponse = { task: { id: string; owner: string; agentId: string; maxPerCallAtomic: string }; graph: { budgetAtomic: string; spentAtomic: string; remainingAtomic: string; providers: Array<{ providerId: string; channelCeilingAtomic: string; spentAtomic: string }>; flows: Flow[] }; settlement: { status: string; authorizedSpendAtomic: string; recoverableAtomic: string; transactions: Array<{ providerId: string; transactionSignature: string }> } };

const providers: Record<ProviderId, { name: string; price: string }> = { search: { name: "Search", price: "$0.05" }, data: { name: "Data", price: "$0.03" }, inference: { name: "Inference", price: "$0.12" } };

function usd(value: string) { return `$${(Number(BigInt(value)) / 1_000_000).toFixed(2)}`; }
function compact(value?: string) { if (!value) return "—"; return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value; }

export function DemoTaskRunner() {
  const [budget, setBudget] = useState("1.00");
  const [cap, setCap] = useState("0.25");
  const [selected, setSelected] = useState<ProviderId[]>(["search", "data", "inference"]);
  const [response, setResponse] = useState<DemoResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const spentPercent = useMemo(() => response ? Math.round((Number(BigInt(response.graph.spentAtomic)) / Number(BigInt(response.graph.budgetAtomic))) * 100) : 0, [response]);

  function toggle(id: ProviderId) {
    setSelected((current) => current.includes(id) ? (current.length === 1 ? current : current.filter((value) => value !== id)) : [...current, id]);
  }

  async function run() {
    setRunning(true); setError("");
    try {
      const result = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ budgetUsd: budget, maxPerCallUsd: cap, allowedProviders: selected }) });
      const payload = await result.json() as DemoResponse | { error: string };
      if (!result.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Task failed.");
      setResponse(payload);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Task failed."); }
    finally { setRunning(false); }
  }

  return (
    <div className="task-runner-grid">
      <section className="product-card task-config-card">
        <div className="card-label">Task configuration</div>
        <h2>Reference research task</h2>
        <p>Exercise the real Canalis policy/orchestration path with deterministic providers. No blockchain signatures are fabricated.</p>
        <div className="form-grid">
          <label><span>Task budget</span><div className="money-field"><b>$</b><input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" /><em>USDC</em></div></label>
          <label><span>Max per call</span><div className="money-field"><b>$</b><input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" /><em>USDC</em></div></label>
        </div>
        <div className="field-label-row"><span>Allowed providers</span><small>{selected.length} selected</small></div>
        <div className="provider-select-grid">
          {(Object.keys(providers) as ProviderId[]).map((id) => <button className={selected.includes(id) ? "selected" : ""} type="button" onClick={() => toggle(id)} key={id}><span>{providers[id].name}</span><small>{providers[id].price}</small><i>{selected.includes(id) ? "✓" : "+"}</i></button>)}
        </div>
        <button className="primary-action wide" type="button" onClick={run} disabled={running}>{running ? "Routing provider payments…" : "Run reference task"}<span>→</span></button>
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
      </section>

      <section className="product-card task-live-card">
        <div className="task-live-head"><div><div className="card-label">Execution</div><h2>{response ? "Task complete" : "Ready to execute"}</h2></div><span className={`status-chip ${response ? "success" : "neutral"}`}>{response ? "Complete" : "Idle"}</span></div>
        <div className="budget-summary"><div><span>Authorized</span><strong>{response ? usd(response.graph.spentAtomic) : "$0.00"}</strong></div><div><span>Recoverable</span><strong>{response ? usd(response.graph.remainingAtomic) : `$${budget}`}</strong></div><div><span>Utilization</span><strong>{spentPercent}%</strong></div></div>
        <div className="utilization-track"><span style={{ width: `${spentPercent}%` }} /></div>
        <div className="flow-timeline">
          {response ? response.graph.flows.map((flow, index) => <article key={flow.id} className={`flow-event ${flow.status}`}><div className="flow-index">{index + 1}</div><div><div className="flow-event-top"><strong>{providers[flow.providerId as ProviderId]?.name ?? flow.providerId}</strong><span>{usd(flow.quotedAmountAtomic)}</span></div><p>{flow.status === "fulfilled" ? "Policy approved · receipt captured" : flow.rejectionCode}</p><small>{flow.status === "fulfilled" ? `Cumulative ${usd(flow.nextCumulativeAtomic)} · ${compact(flow.paymentReference)}` : flow.rejectionMessage}</small></div></article>) : <div className="empty-panel"><span>◎</span><strong>No execution yet</strong><p>Run the reference task to inspect policy decisions, receipts, and recoverable budget.</p></div>}
        </div>
        {response ? <div className="settlement-strip"><span>Settlement state</span><strong>Awaiting live on-chain finalization</strong><small>The interactive task does not invent transaction signatures.</small></div> : null}
      </section>
    </div>
  );
}
