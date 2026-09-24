import Link from "next/link";
import { DemoTaskRunner } from "../../../../components/product/demo-task-runner";
import { PageHeader } from "../../../../components/product/page-header";
import { TaskRecord } from "../../../../components/product/task-record";

export const metadata = { title: "Task" };

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "demo") {
    return <div className="page-stack"><PageHeader eyebrow="Task · deterministic" title="Reference research task" description="Run the current Canalis orchestration path and inspect its policy decisions, payment references, receipts, and recoverable budget." actions={<Link className="secondary-action" href="/tasks">All tasks</Link>} /><DemoTaskRunner /></div>;
  }
  return <div className="page-stack"><PageHeader eyebrow="Task record" title="Persisted task" description="Wallet-owned configuration, lifecycle state, budget accounting, and provider scope loaded from durable Canalis storage." /><TaskRecord taskId={id} /></div>;
}
