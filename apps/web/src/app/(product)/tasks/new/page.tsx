import Link from "next/link";
import { PageHeader } from "../../../../components/product/page-header";
import { PolicyTaskComposer } from "../../../../components/product/policy-task-composer";

export const metadata = { title: "New policy-backed task" };

export default function NewTaskPage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Governed task"
        title="New policy-backed task"
        description="Select an immutable policy version, review its guardrails, apply explicit task-only overrides, and create a task whose authorization rules remain auditable for its full lifecycle."
        actions={<Link className="secondary-action" href="/policies">Manage policies <span>→</span></Link>}
      />
      <PolicyTaskComposer />
    </div>
  );
}
