import Link from "next/link";
import { PageHeader } from "../../../components/product/page-header";
import { referenceProviders } from "../../../lib/product-reference";

export const metadata = { title: "Providers" };

export default function ProvidersPage() {
  return <div className="page-stack"><PageHeader eyebrow="Integrations" title="Providers" description="Machine services available to the current reference workflow. Each adapter declares its price and role; no hidden credentials are exposed in the browser." />
    <section className="provider-card-grid">{referenceProviders.map((provider, index) => <article className="product-card provider-card" key={provider.id}><div className="provider-card-top"><span className="provider-logo">{String(index + 1).padStart(2, "0")}</span><span className="status-chip success"><i />Ready</span></div><h2>{provider.name}</h2><p>{provider.role}</p><dl><div><dt>Protocol</dt><dd>{provider.protocol}</dd></div><div><dt>Reference price</dt><dd>{provider.price} / call</dd></div><div><dt>Network</dt><dd>Application demo</dd></div></dl><Link href="/tasks/demo">Use in reference task <span>→</span></Link></article>)}</section>
    <section className="empty-workspace compact"><div className="empty-symbol">⌁</div><div><h2>Live provider registry is intentionally separate</h2><p>x402, MPP, endpoint health, secrets, pricing configuration, and enable/disable controls belong to the dedicated Provider Registry issue rather than fake controls on this page.</p></div></section>
  </div>;
}
