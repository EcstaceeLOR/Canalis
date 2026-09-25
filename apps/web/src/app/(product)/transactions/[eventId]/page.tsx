import { TransactionDetail } from "../../../../components/product/transaction-detail";

export const metadata = { title: "Transaction event" };

export default async function TransactionEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <TransactionDetail eventId={eventId} />;
}
