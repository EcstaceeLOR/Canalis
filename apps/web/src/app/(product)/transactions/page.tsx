import { PageHeader } from "../../../components/product/page-header";
import { TransactionsWorkspace } from "../../../components/product/transactions-workspace";

export const metadata = { title: "Transactions & receipts" };

export default function TransactionsPage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Audit"
        title="Transactions & receipts"
        description="Trace every Canalis payment authorization, provider receipt, channel transaction, settlement, distribution, recovery, and failure from one reconciled wallet-scoped ledger."
      />
      <TransactionsWorkspace />
    </div>
  );
}
