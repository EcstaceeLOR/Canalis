import { PageHeader } from "../../../components/product/page-header";
import { ActivityWorkspace } from "../../../components/product/activity-workspace";

export const metadata = { title: "Activity" };

export default function ActivityPage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operations"
        title="Activity & recovery"
        description="Review durable task, provider, channel, settlement, recovery, and integration events. Open incidents stay visible until the underlying canonical state is healthy again."
      />
      <ActivityWorkspace />
    </div>
  );
}
