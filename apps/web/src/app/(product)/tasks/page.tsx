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
        description="Create, revisit, filter, and manage wallet-owned autonomous payment tasks. Every record below is persisted in Canalis rather than manufactured demo history."
      />
      <LiveDevnetTaskCreator />
      <TasksWorkspace />
    </div>
  );
}
