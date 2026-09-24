import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoTaskRunner } from "../../../../components/product/demo-task-runner";
import { PageHeader } from "../../../../components/product/page-header";

export const metadata = { title: "Reference task" };

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id !== "demo") notFound();
  return <div className="page-stack"><PageHeader eyebrow="Task · deterministic" title="Reference research task" description="Run the current Canalis orchestration path and inspect its policy decisions, payment references, receipts, and recoverable budget." actions={<Link className="secondary-action" href="/tasks">All tasks</Link>} /><DemoTaskRunner /></div>;
}
