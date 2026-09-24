import { PageHeader, SectionHeader } from "../../../components/product/page-header";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return <div className="page-stack"><PageHeader eyebrow="Environment" title="Settings" description="Current runtime boundaries and safety posture. This page exposes only configuration that is already true; it does not present unsaved controls as functional." />
    <div className="settings-grid"><section className="product-card settings-section"><SectionHeader title="Runtime" detail="Active product environment" /><div className="settings-list"><div><span>Application mode</span><strong>Deterministic reference</strong><small>Interactive task API</small></div><div><span>Solana cluster</span><strong>Devnet</strong><small>Real channel proof only</small></div><div><span>Default asset display</span><strong>USDC</strong><small>Reference task accounting</small></div></div></section><section className="product-card settings-section"><SectionHeader title="Security boundary" detail="Client/server handling" /><div className="settings-list"><div><span>Private keys</span><strong className="success-text">Never stored</strong><small>Wallet/signers stay outside committed configuration</small></div><div><span>Fabricated signatures</span><strong className="success-text">Never shown</strong><small>Explorer links require real evidence</small></div><div><span>Mainnet assets</span><strong>Not enabled</strong><small>Current live proof is devnet-only</small></div></div></section></div>
    <section className="empty-workspace compact"><div className="empty-symbol">⚙</div><div><h2>Editable account integrations are not enabled yet</h2><p>Network preferences, x402/MPP endpoints, secrets, notification preferences, connection tests, and save/rollback behavior belong to the dedicated Settings & Integrations issue.</p></div></section>
  </div>;
}
