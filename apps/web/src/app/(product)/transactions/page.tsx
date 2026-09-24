import { PageHeader, SectionHeader } from "../../../components/product/page-header";
import { devnetProof, explorerTx, shortAddress } from "../../../lib/product-reference";

export const metadata = { title: "Transactions" };

export default function TransactionsPage() {
  const rows = [{ type: "Channel open", amount: "100,000 ceiling", signature: devnetProof.openSignature, status: "Confirmed" }, { type: "Settlement", amount: "30,000 settled", signature: devnetProof.settleSignature, status: "Confirmed" }];
  return <div className="page-stack"><PageHeader eyebrow="Audit" title="Transactions & receipts" description="A clean separation between real on-chain evidence and application-level receipt data. Only signatures that actually exist are linked to Explorer." />
    <section className="product-card table-card"><SectionHeader title="Verified on-chain transactions" detail="Solana devnet · payment-channel proof" /><div className="responsive-table transactions-table"><div className="table-head"><span>Event</span><span>Amount</span><span>Network</span><span>Status</span><span>Signature</span></div>{rows.map((row) => <a className="table-row" href={explorerTx(row.signature)} target="_blank" rel="noreferrer" key={row.signature}><div><span className="table-primary">{row.type}</span><small>Canonical payment-channel lifecycle</small></div><span>{row.amount}</span><span>Devnet</span><span><i className="status-dot ready" />{row.status}</span><b>{shortAddress(row.signature, 9, 7)} ↗</b></a>)}</div></section>
    <section className="empty-workspace compact"><div className="empty-symbol">≡</div><div><h2>No persisted application receipts yet</h2><p>The interactive reference task generates receipts in-session. Persistent receipt history, search, export, and cross-linking are introduced by the Transactions explorer issue.</p></div></section>
  </div>;
}
