import { PageHeader } from "../../../components/product/page-header";
import { ChannelsWorkspace } from "../../../components/product/channels-workspace";

export const metadata = { title: "Channels" };

export default function ChannelsPage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Settlement operations"
        title="Channels"
        description="Monitor every wallet-owned payment channel, reconcile authorized spend against recoverable escrow, and perform only state-safe terminal actions against real Solana evidence."
      />
      <ChannelsWorkspace />
    </div>
  );
}
