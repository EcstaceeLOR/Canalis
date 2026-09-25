import { AnalyticsWorkspace } from "../../../components/product/analytics-workspace";
import { PageHeader } from "../../../components/product/page-header";

export const metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return <div className="page-stack">
    <PageHeader
      eyebrow="Analytics"
      title="Spend, recovery & reliability"
      description="Analyze authorized, settled, and recovered value alongside task outcomes, provider calls, settlement latency, and operational breakdowns derived from persisted Canalis data."
    />
    <AnalyticsWorkspace />
  </div>;
}
