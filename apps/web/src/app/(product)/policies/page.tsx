import Link from "next/link";
import { PageHeader } from "../../../components/product/page-header";
import { PoliciesWorkspace } from "../../../components/product/policies-workspace";

export const metadata = { title: "Policies" };

export default function PoliciesPage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Guardrails"
        title="Policies"
        description="Create reusable, versioned spending rules for autonomous tasks. Every task receives an immutable snapshot, so later policy edits never rewrite historical authorization rules."
        actions={<Link className="secondary-action" href="/tasks/new">Create policy-backed task <span>→</span></Link>}
      />
      <PoliciesWorkspace />
    </div>
  );
}
