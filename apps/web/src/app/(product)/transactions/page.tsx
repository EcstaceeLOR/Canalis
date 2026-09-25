import { PageHeader } from "../../../components/product/page-header";
import { TransactionsWorkspace } from "../../../components/product/transactions-workspace";

export const metadata = { title: "Transactions" };

export default function TransactionsPage() {
  return <div className="page-stack">
    <PageHeader
      eyebrow="Audit"
      title="Transactions & receipts"
      description="Trace every paid authorization, receipt, channel action, settlement, distribution, and recovery event back to the task and provider that produced it."
    />
    <TransactionsWorkspace />
  </div>;
}
