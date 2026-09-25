import Link from "next/link";
import { DashboardWorkspace } from "../../../components/product/dashboard-workspace";
import { PageHeader } from "../../../components/product/page-header";

export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return <div className="page-stack">
    <PageHeader
      eyebrow="Operations"
      title="Operational dashboard"
      description="Monitor wallet-scoped tasks, payment channels, provider health, settlement state, recoverable funds, and persisted payment activity from one control surface."
      actions={<Link className="primary-action" href="/tasks/new">Create task <span>→</span></Link>}
    />
    <DashboardWorkspace />
  </div>;
}
