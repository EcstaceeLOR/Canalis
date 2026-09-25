import Link from "next/link";
import { PageHeader } from "../../../components/product/page-header";
import { LiveDevnetTaskCreator } from "../../../components/product/live-devnet-task-creator";
import { TasksWorkspace } from "../../../components/product/tasks-workspace";

export const metadata = { title: "Tasks" };

export default function TasksPage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Workspace"
        title="Tasks"
        description="Create, revisit, filter, and manage wallet-owned autonomous payment tasks. Use reusable policies when you want versioned guardrails and explicit per-task overrides."
        actions={<Link className="secondary-action" href="/tasks/new">New policy-backed task <span>→</span></Link>}
      />
      <LiveDevnetTaskCreator />
      <TasksWorkspace />
    </div>
  );
}
