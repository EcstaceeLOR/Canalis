import Link from "next/link";
import { CanalisLogo } from "../components/brand/canalis-logo";
import { devnetProof, explorerAddress, explorerTx, shortAddress } from "../lib/product-reference";

export default function LandingPage() {
  return (
    <main className="landing-shell">
      <nav className="landing-nav">
        <Link href="/" aria-label="Canalis home"><CanalisLogo /></Link>
        <div className="landing-nav-links"><a href="#product">Product</a><a href="#proof">Proof</a><Link href="/providers">Providers</Link></div>
        <Link className="landing-launch" href="/dashboard">Launch app <span>→</span></Link>
      </nav>

      <section className="landing-hero">
        <div className="landing-orbit orbit-one" /><div className="landing-orbit orbit-two" />
        <div className="landing-hero-copy">
          <span className="landing-kicker"><i />Payment infrastructure for autonomous agents</span>
          <h1>Agents can move fast.<br/><em>Their money should stay governed.</em></h1>
          <p>Canalis gives software agents bounded budgets, routes paid machine-service calls under policy, records every authorization, and reconciles what was spent versus what returns to the payer.</p>
          <div className="landing-cta-row"><Link className="landing-primary" href="/tasks/demo">Run a task <span>→</span></Link><Link className="landing-secondary" href="/dashboard">Explore control plane</Link></div>
          <div className="landing-trust-row"><span><b>100k</b> proven channel ceiling</span><span><b>30k</b> actual settlement</span><span><b>70k</b> recovered unused capacity</span></div>
        </div>
        <div className="landing-visual" aria-label="Canalis payment routing illustration">
          <div className="visual-card visual-policy"><small>POLICY</small><strong>$1.00 USDC</strong><span>Max / call · $0.25</span></div>
          <div className="visual-agent"><span>AI</span><small>Agent task</small></div>
          <div className="visual-route route-a"><i /><span>Search</span><b>$0.05</b></div>
          <div className="visual-route route-b"><i /><span>Data</span><b>$0.03</b></div>
          <div className="visual-route route-c"><i /><span>Inference</span><b>$0.12</b></div>
          <div className="visual-settle"><small>RECOVERABLE</small><strong>$0.80</strong></div>
        </div>
      </section>

      <section className="landing-product" id="product">
        <div className="landing-section-heading"><span>What Canalis controls</span><h2>One budget. Every paid action accounted for.</h2></div>
        <div className="landing-feature-grid">
          <article><span>01</span><h3>Bounded autonomy</h3><p>Task ceilings, per-call caps, provider allowlists, and cumulative authorization stop an agent from spending outside its mandate.</p></article>
          <article><span>02</span><h3>Machine-service routing</h3><p>Providers sit behind one orchestration layer while Canalis records quote, policy decision, authorization, response hash, and receipt.</p></article>
          <article><span>03</span><h3>Payment-channel settlement</h3><p>High-frequency authorization happens offchain; actual cumulative usage can settle on Solana while unused capacity returns to the payer.</p></article>
        </div>
      </section>

      <section className="landing-proof" id="proof">
        <div><span className="landing-kicker"><i />Real devnet evidence</span><h2>The primitive is already proven on Solana.</h2><p>Canalis opened the canonical payment channel with a 100,000-unit ceiling, settled 30,000 units to the provider, and returned 70,000 unused units to the payer.</p><div className="proof-links"><a href={explorerAddress(devnetProof.channel)} target="_blank" rel="noreferrer">Channel {shortAddress(devnetProof.channel)} ↗</a><a href={explorerTx(devnetProof.settleSignature)} target="_blank" rel="noreferrer">Settlement transaction ↗</a></div></div>
        <div className="proof-ledger"><div><span>Authorized maximum</span><strong>100,000</strong></div><div><span>Actual provider settlement</span><strong>30,000</strong></div><div className="positive"><span>Returned to payer</span><strong>70,000</strong></div><small>Solana devnet · canonical payment-channels program</small></div>
      </section>

      <footer className="landing-footer"><CanalisLogo /><p>Payment orchestration for autonomous agents.</p><Link href="/dashboard">Open product →</Link></footer>
    </main>
  );
}
