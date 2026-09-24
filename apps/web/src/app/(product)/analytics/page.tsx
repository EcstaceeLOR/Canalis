import { MetricCard, PageHeader, SectionHeader } from "../../../components/product/page-header";

export const metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return <div className="page-stack"><PageHeader eyebrow="Reference analytics" title="Spend & recovery" description="Analytics shown here are derived only from the reproducible $1.00 reference task and verified devnet channel proof—not fabricated account history." />
    <section className="metric-row"><MetricCard label="Approved task budget" value="$1.00" detail="Reference workflow" /><MetricCard label="Authorized spend" value="$0.20" detail="20% utilization" tone="brand" /><MetricCard label="Recoverable capacity" value="$0.80" detail="80% unspent" tone="positive" /><MetricCard label="Provider calls" value="3" detail="All within $0.25 cap" /></section>
    <div className="analytics-grid"><section className="product-card"><SectionHeader title="Budget utilization" detail="Reference task composition" /><div className="donut-layout"><div className="analytics-donut"><div><strong>20%</strong><span>spent</span></div></div><div className="analytics-legend"><div><i className="legend-spent" /><span>Authorized spend</span><strong>$0.20</strong></div><div><i className="legend-recovered" /><span>Recoverable</span><strong>$0.80</strong></div></div></div></section><section className="product-card"><SectionHeader title="Provider mix" detail="Reference prices per successful call" /><div className="bar-list"><div><span>Inference</span><i><b style={{ width: "60%" }} /></i><strong>$0.12</strong></div><div><span>Search</span><i><b style={{ width: "25%" }} /></i><strong>$0.05</strong></div><div><span>Data</span><i><b style={{ width: "15%" }} /></i><strong>$0.03</strong></div></div></section></div>
    <section className="empty-workspace compact"><div className="empty-symbol">∿</div><div><h2>Account-level time series require persistence</h2><p>24h/7d/30d/custom analytics will derive from persisted task, channel, provider, and transaction records once those product layers exist.</p></div></section>
  </div>;
}
