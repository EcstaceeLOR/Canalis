"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWalletIdentity } from "../wallet/wallet-identity";

type TaskStatus = "draft" | "active" | "completed" | "cancelled" | "archived";
type TaskSummary = {
  id: string;
  name: string;
  description: string;
  owner: string;
  agentId: string;
  mode: string;
  status: TaskStatus;
  mint: string;
  budgetAtomic: string;
  spentAtomic: string;
  recoverableAtomic: string;
  allowedProviders: string[];
  policyId: string;
  createdAtUnixSeconds: string;
  expiresAtUnixSeconds: string;
  updatedAtUnixSeconds: string;
};

type TaskList = {
  tasks: TaskSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type FormState = {
  name: string;
  description: string;
  agentId: string;
  budgetUsd: string;
  maxPerCallUsd: string;
  expiryMinutes: string;
  providers: string[];
  policyId: string;
};

const defaultForm: FormState = {
  name: "",
  description: "",
  agentId: "canalis-research-agent",
  budgetUsd: "1.00",
  maxPerCallUsd: "0.25",
  expiryMinutes: "60",
  providers: ["search", "data", "inference"],
  policyId: "inline-bounded",
};

function usd(atomic: string) {
  const value = Number(atomic) / 1_000_000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

function shortAddress(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

function when(unix: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(Number(unix) * 1000));
}

async function errorMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function TasksWorkspace() {
  const { session, status: walletStatus } = useWalletIdentity();
  const [result, setResult] = useState<TaskList>({ tasks: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"table" | "cards">("table");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [form, setForm] = useState<FormState>(defaultForm);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [provider, setProvider] = useState("all");
  const [range, setRange] = useState("all");
  const [sort, setSort] = useState("updated_desc");
  const [page, setPage] = useState(1);

  const queryString = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: "20", sort });
    if (search.trim()) query.set("q", search.trim());
    if (statusFilter !== "all") query.set("status", statusFilter);
    if (provider !== "all") query.set("provider", provider);
    if (range !== "all") {
      const seconds = range === "24h" ? 86_400 : range === "7d" ? 604_800 : 2_592_000;
      query.set("from", String(Math.floor(Date.now() / 1000) - seconds));
    }
    return query.toString();
  }, [page, provider, range, search, sort, statusFilter]);

  const load = useCallback(async () => {
    if (!session) {
      setResult({ tasks: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks?${queryString}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setResult((await response.json()) as TaskList);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }, [queryString, session]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => setPage(1), [provider, range, search, sort, statusFilter]);

  function toggleProvider(id: string) {
    setForm((current) => ({
      ...current,
      providers: current.providers.includes(id)
        ? current.providers.filter((providerId) => providerId !== id)
        : [...current.providers, id],
    }));
  }

  async function createTask(saveAsDraft: boolean) {
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          agentId: form.agentId,
          budgetUsd: form.budgetUsd,
          maxPerCallUsd: form.maxPerCallUsd,
          expiryMinutes: Number(form.expiryMinutes),
          allowedProviders: form.providers,
          policyId: form.policyId,
          saveAsDraft,
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setCreateOpen(false);
      setForm(defaultForm);
      setNotice(saveAsDraft ? "Draft saved." : "Task created and ready to run.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create task.");
    } finally {
      setCreating(false);
    }
  }

  async function lifecycle(
    task: TaskSummary,
    action: "submit" | "cancel" | "archive" | "duplicate" | "rerun",
  ) {
    setBusyId(task.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/tasks/${task.id}/lifecycle`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setNotice(
        action === "duplicate"
          ? "Task configuration copied to a new draft."
          : action === "rerun"
            ? "Fresh task created from that configuration."
            : `Task ${action} complete.`,
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Task action failed.");
    } finally {
      setBusyId("");
    }
  }

  if (!session) {
    return (
      <section className="tasks-connect-state">
        <div className="empty-symbol">◎</div>
        <div>
          <h2>Connect your wallet to open your task workspace</h2>
          <p>
            Tasks are private to the authenticated Solana wallet that created them. {walletStatus === "loading"
              ? "Checking your existing session…"
              : "Use Connect wallet in the top bar to continue."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="tasks-workspace">
      <div className="tasks-toolbar">
        <div className="tasks-search">
          <span>⌕</span>
          <input
            aria-label="Search tasks"
            placeholder="Search name, description, task ID…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="archived">Archived</option>
        </select>
        <select aria-label="Filter by provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
          <option value="all">All providers</option>
          <option value="search">Search</option>
          <option value="data">Data</option>
          <option value="inference">Inference</option>
        </select>
        <select aria-label="Filter by creation date" value={range} onChange={(event) => setRange(event.target.value)}>
          <option value="all">Any date</option>
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        <select aria-label="Sort tasks" value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="updated_desc">Recently active</option>
          <option value="created_desc">Newest</option>
          <option value="created_asc">Oldest</option>
          <option value="name_asc">Name A–Z</option>
        </select>
        <div className="tasks-view-toggle">
          <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}>☷</button>
          <button type="button" className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}>▦</button>
        </div>
        <button className="primary-action" type="button" onClick={() => setCreateOpen(true)}>
          New task <span>＋</span>
        </button>
      </div>

      {notice ? <div className="tasks-notice" role="status">{notice}</div> : null}
      {error ? <div className="tasks-error" role="alert">{error}<button type="button" onClick={() => void load()}>Retry</button></div> : null}

      <div className="tasks-list-head">
        <div><strong>{result.total}</strong><span> tasks for {shortAddress(session.walletAddress)}</span></div>
        {loading ? <span className="tasks-loading">Refreshing…</span> : null}
      </div>

      {loading && result.tasks.length === 0 ? (
        <div className="tasks-skeletons">{[0, 1, 2, 3].map((item) => <div className="tasks-skeleton" key={item} />)}</div>
      ) : result.tasks.length === 0 ? (
        <section className="tasks-empty">
          <div className="empty-symbol">＋</div>
          <div>
            <h2>{search || statusFilter !== "all" || provider !== "all" || range !== "all" ? "No tasks match these filters" : "Create your first governed task"}</h2>
            <p>{search || statusFilter !== "all" || provider !== "all" || range !== "all"
              ? "Change or clear the workspace filters to broaden the result set."
              : "Set a bounded budget, choose paid providers, save a draft or create an active task. It will remain here across refreshes and deployments."}</p>
          </div>
          <button type="button" onClick={() => setCreateOpen(true)}>Create task</button>
        </section>
      ) : view === "table" ? (
        <div className="tasks-table-wrap">
          <table className="tasks-table">
            <thead>
              <tr>
                <th>Task</th><th>Status</th><th>Budget</th><th>Spent</th><th>Recoverable</th><th>Providers</th><th>Owner</th><th>Created</th><th>Last activity</th><th />
              </tr>
            </thead>
            <tbody>{result.tasks.map((task) => <TaskRow key={task.id} task={task} busy={busyId === task.id} lifecycle={lifecycle} />)}</tbody>
          </table>
        </div>
      ) : (
        <div className="tasks-card-grid">{result.tasks.map((task) => <TaskCard key={task.id} task={task} busy={busyId === task.id} lifecycle={lifecycle} />)}</div>
      )}

      {result.totalPages > 1 ? (
        <div className="tasks-pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Previous</button>
          <span>Page {result.page} of {result.totalPages}</span>
          <button type="button" disabled={page >= result.totalPages} onClick={() => setPage((value) => Math.min(result.totalPages, value + 1))}>Next →</button>
        </div>
      ) : null}

      {createOpen ? (
        <TaskComposer
          form={form}
          setForm={setForm}
          toggleProvider={toggleProvider}
          creating={creating}
          close={() => setCreateOpen(false)}
          createTask={createTask}
        />
      ) : null}
    </div>
  );
}

function Status({ status }: { status: TaskStatus }) {
  return <span className={`task-status task-status-${status}`}><i />{status}</span>;
}

function TaskActions({
  task,
  busy,
  lifecycle,
}: {
  task: TaskSummary;
  busy: boolean;
  lifecycle: (task: TaskSummary, action: "submit" | "cancel" | "archive" | "duplicate" | "rerun") => Promise<void>;
}) {
  return (
    <div className="task-actions">
      <Link href={`/tasks/${task.id}`}>Open</Link>
      {task.status === "draft" ? <button disabled={busy} onClick={() => void lifecycle(task, "submit")}>Submit</button> : null}
      {["draft", "active"].includes(task.status) ? <button disabled={busy} onClick={() => void lifecycle(task, "cancel")}>Cancel</button> : null}
      {["draft", "completed", "cancelled"].includes(task.status) ? <button disabled={busy} onClick={() => void lifecycle(task, "archive")}>Archive</button> : null}
      <button disabled={busy} onClick={() => void lifecycle(task, "duplicate")}>Duplicate</button>
      {["completed", "cancelled", "archived"].includes(task.status) ? <button disabled={busy} onClick={() => void lifecycle(task, "rerun")}>Re-run</button> : null}
    </div>
  );
}

function TaskRow({
  task,
  busy,
  lifecycle,
}: {
  task: TaskSummary;
  busy: boolean;
  lifecycle: Parameters<typeof TaskActions>[0]["lifecycle"];
}) {
  return (
    <tr>
      <td><Link className="task-name" href={`/tasks/${task.id}`}>{task.name}</Link><small>{task.id.slice(0, 18)}…</small></td>
      <td><Status status={task.status} /></td>
      <td>{usd(task.budgetAtomic)}</td>
      <td>{usd(task.spentAtomic)}</td>
      <td>{usd(task.recoverableAtomic)}</td>
      <td><div className="provider-chips">{task.allowedProviders.map((id) => <span key={id}>{id}</span>)}</div></td>
      <td title={task.owner}>{shortAddress(task.owner)}</td>
      <td>{when(task.createdAtUnixSeconds)}</td>
      <td>{when(task.updatedAtUnixSeconds)}</td>
      <td><TaskActions task={task} busy={busy} lifecycle={lifecycle} /></td>
    </tr>
  );
}

function TaskCard({
  task,
  busy,
  lifecycle,
}: {
  task: TaskSummary;
  busy: boolean;
  lifecycle: Parameters<typeof TaskActions>[0]["lifecycle"];
}) {
  return (
    <article className="task-card">
      <div className="task-card-top"><Status status={task.status} /><small>Updated {when(task.updatedAtUnixSeconds)}</small></div>
      <Link href={`/tasks/${task.id}`}><h3>{task.name}</h3></Link>
      <p>{task.description || "No description"}</p>
      <div className="task-card-meta">
        <span title={task.owner}>Owner {shortAddress(task.owner)}</span>
        <span>Created {when(task.createdAtUnixSeconds)}</span>
      </div>
      <div className="task-card-metrics">
        <div><span>Budget</span><strong>{usd(task.budgetAtomic)}</strong></div>
        <div><span>Spent</span><strong>{usd(task.spentAtomic)}</strong></div>
        <div><span>Recoverable</span><strong>{usd(task.recoverableAtomic)}</strong></div>
      </div>
      <div className="provider-chips">{task.allowedProviders.map((id) => <span key={id}>{id}</span>)}</div>
      <TaskActions task={task} busy={busy} lifecycle={lifecycle} />
    </article>
  );
}

function TaskComposer({
  form,
  setForm,
  toggleProvider,
  creating,
  close,
  createTask,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  toggleProvider: (id: string) => void;
  creating: boolean;
  close: () => void;
  createTask: (draft: boolean) => Promise<void>;
}) {
  const valid = form.name.trim() && form.providers.length > 0 && Number(form.budgetUsd) > 0 && Number(form.maxPerCallUsd) > 0;
  return (
    <div className="task-modal-backdrop" role="presentation" onMouseDown={close}>
      <div className="task-composer" role="dialog" aria-modal="true" aria-label="Create Canalis task" onMouseDown={(event) => event.stopPropagation()}>
        <div className="task-composer-head">
          <div>
            <span>New autonomous payment task</span>
            <h2>Define the task envelope</h2>
            <p>The wallet owns the task. Canalis enforces these limits server-side.</p>
          </div>
          <button type="button" onClick={close}>×</button>
        </div>
        <div className="task-form-grid">
          <label className="task-field task-field-wide"><span>Name</span><input autoFocus maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Research competitor pricing" /></label>
          <label className="task-field task-field-wide"><span>Description</span><textarea maxLength={1000} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="What should this agent accomplish?" /></label>
          <label className="task-field"><span>Budget (USDC)</span><input inputMode="decimal" value={form.budgetUsd} onChange={(event) => setForm((current) => ({ ...current, budgetUsd: event.target.value }))} /></label>
          <label className="task-field"><span>Max per call</span><input inputMode="decimal" value={form.maxPerCallUsd} onChange={(event) => setForm((current) => ({ ...current, maxPerCallUsd: event.target.value }))} /></label>
          <label className="task-field"><span>Expiry</span><select value={form.expiryMinutes} onChange={(event) => setForm((current) => ({ ...current, expiryMinutes: event.target.value }))}><option value="15">15 minutes</option><option value="60">1 hour</option><option value="360">6 hours</option><option value="1440">24 hours</option><option value="10080">7 days</option></select></label>
          <label className="task-field"><span>Policy</span><select value={form.policyId} onChange={(event) => setForm((current) => ({ ...current, policyId: event.target.value }))}><option value="inline-bounded">Inline bounded-spend policy</option></select><small>Saved reusable policies arrive in the Policies workspace; this policy snapshot is persisted with the task.</small></label>
          <label className="task-field task-field-wide"><span>Agent ID</span><input value={form.agentId} onChange={(event) => setForm((current) => ({ ...current, agentId: event.target.value }))} /></label>
          <fieldset className="task-field task-field-wide">
            <legend>Provider allowlist</legend>
            <div className="provider-selector">
              {["search", "data", "inference"].map((id) => (
                <label key={id}>
                  <input type="checkbox" checked={form.providers.includes(id)} onChange={() => toggleProvider(id)} />
                  <span><strong>{id[0].toUpperCase() + id.slice(1)}</strong><small>Deterministic provider</small></span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="task-composer-actions">
          <button className="secondary-action" type="button" disabled={!valid || creating} onClick={() => void createTask(true)}>{creating ? "Saving…" : "Save draft"}</button>
          <button className="primary-action" type="button" disabled={!valid || creating} onClick={() => void createTask(false)}>{creating ? "Creating…" : "Create active task"} <span>→</span></button>
        </div>
      </div>
    </div>
  );
}
