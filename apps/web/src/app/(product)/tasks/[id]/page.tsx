import Link from "next/link";
import { DemoTaskRunner } from "../../../../components/product/demo-task-runner";
import { LiveChannelPanel } from "../../../../components/product/live-channel-panel";
import { PageHeader } from "../../../../components/product/page-header";
import { TaskRecord } from "../../../../components/product/task-record";

export const metadata = { title: "Task record" };

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (id === "demo") {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="Task detail"
          title="Reference task"
          description="A deterministic, reproducible task detail view using the same bounded policy and payment graph as the judge path."
          actions={<Link href="/tasks" className="secondary-action">Back to tasks</Link>}
        />
        <DemoTaskRunner />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Task operations"
        title="Task record"
        description="Inspect durable configuration, provider execution, receipts, payment graph state, channel evidence and recovery controls for this wallet-owned task."
        actions={<Link href="/tasks" className="secondary-action">Back to tasks</Link>}
      />
      <LiveChannelPanel taskId={id} />
      <TaskRecord taskId={id} />
    </div>
  );
}
