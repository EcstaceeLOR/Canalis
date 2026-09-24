import Link from "next/link";
import { PageHeader, SectionHeader } from "../../../components/product/page-header";

export const metadata = { title: "Tasks" };

export default function TasksPage() {
  return <div className="page-stack"><PageHeader eyebrow="Workspace" title="Tasks" description="Create, run, and inspect bounded agent-payment workflows. The reference task exercises the current orchestration path without pretending persistence exists." actions={<Link className="primary-action" href="/tasks/demo">Run reference task <span>→</span></Link>} />
    <section className="product-card table-card"><SectionHeader title="Available task workflows" detail="Interactive and truthful to the current product state" /><div className="responsive-table"><div className="table-head"><span>Task</span><span>Mode</span><span>Budget</span><span>Providers</span><span>Status</span><span /></div><Link className="table-row" href="/tasks/demo"><div><span className="table-primary">Reference research task</span><small>Policy → providers → receipts → recovery</small></div><span>Deterministic</span><span>$1.00 USDC</span><span>3 providers</span><span><i className="status-dot ready" />Ready</span><b>Open →</b></Link></div></section>
    <section className="empty-workspace"><div className="empty-symbol">＋</div><div><h2>No persisted user tasks yet</h2><p>Canalis does not manufacture account history. Persistent task creation, search, filters, and lifecycle controls are introduced by the dedicated Tasks workspace issue.</p></div><Link href="/tasks/demo">Use the reference workflow</Link></section>
  </div>;
}
