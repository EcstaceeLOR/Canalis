import { PageHeader } from "../../../../components/product/page-header";
import { TransactionDetail } from "../../../../components/product/transaction-detail";

export const metadata = { title: "Transaction detail" };

export default async function TransactionDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <div className="page-stack">
    <PageHeader eyebrow="Audit record" title="Transaction / receipt detail" description="Inspect the normalized metadata and proof linking this event to its task, provider, channel, and settlement lifecycle." />
    <TransactionDetail eventId={decodeURIComponent(eventId)} />
  </div>;
}
