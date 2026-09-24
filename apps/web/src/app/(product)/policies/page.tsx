import Link from "next/link";
import { PageHeader, SectionHeader } from "../../../components/product/page-header";
import { referencePolicy } from "../../../lib/product-reference";

export const metadata = { title: "Policies" };

export default function PoliciesPage() {
  return <div className="page-stack"><PageHeader eyebrow="Guardrails" title="Policies" description="Understand the rules that govern agent spend before execution. Current reference policy values are real inputs to the deterministic task path." actions={<Link className="primary-action" href="/tasks/demo">Test policy <span>→</span></Link>} />
    <section className="product-card policy-card"><SectionHeader title={referencePolicy.name} detail="Reference policy · immutable for this demo path" /><div className="policy-rule-grid"><article><span>Task ceiling</span><strong>{referencePolicy.budget}</strong><p>Total authorized spend cannot exceed the approved task budget.</p></article><article><span>Per-call ceiling</span><strong>{referencePolicy.maxPerCall}</strong><p>Quotes above this amount are rejected before paid work is returned.</p></article><article><span>Provider allowlist</span><strong>3 providers</strong><p>{referencePolicy.providers}</p></article><article><span>Network boundary</span><strong>{referencePolicy.network}</strong><p>Real payment-channel proof is isolated from mainnet production assets.</p></article></div><div className="policy-invariant"><span>Core invariant</span><strong>provider payouts + recovered funds = original task budget</strong></div></section>
    <section className="empty-workspace compact"><div className="empty-symbol">◇</div><div><h2>No saved account policies yet</h2><p>Reusable policy creation, versioning, overrides, and archival are intentionally deferred to the dedicated Policies issue.</p></div></section>
  </div>;
}
