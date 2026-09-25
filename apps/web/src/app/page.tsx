import type { Metadata } from "next";
import Link from "next/link";
import { CanalisLogo } from "../components/brand/canalis-logo";
import { ProductStatus } from "../components/public/product-status";
import { devnetProof, explorerAddress, explorerTx, shortAddress } from "../lib/product-reference";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "Governed payments for autonomous agents",
  description: "Canalis gives autonomous agents bounded budgets, policy-controlled machine-service payments, auditable receipts, and Solana payment-channel settlement.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Canalis — Governed payments for autonomous agents",
    description: "Bound an agent budget, route paid machine-service calls under policy, settle cumulative usage on Solana, and recover what was not spent.",
    url: "/",
    type: "website",
  },
};

const githubBase = "https://github.com/EcstaceeLOR/Canalis/blob/main";

export default function LandingPage() {
  return (
    <main className={styles.shell}>
      <nav className={styles.nav} aria-label="Public navigation">
        <Link href="/" aria-label="Canalis home"><CanalisLogo /></Link>
        <div className={styles.navLinks}>
          <a href="#model">Model</a>
          <a href="#capabilities">Capabilities</a>
          <a href="#proof">Proof</a>
          <a href={`${githubBase}/docs/ARCHITECTURE.md`}>Docs</a>
        </div>
        <Link className={styles.launch} href="/onboarding">Launch Canalis <span>→</span></Link>
      </nav>

      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <span className={styles.kicker}><i />Payment control for autonomous agents</span>
          <h1>Give the agent a budget.<br/><em>Keep the money governed.</em></h1>
          <p>Canalis turns one approved task budget into policy-controlled payments across machine-service providers. Every authorization is bounded, recorded, reconciled, and attributable to the wallet that owns the task.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primary} href="/onboarding">Configure your first task <span>→</span></Link>
            <a className={styles.secondary} href={`${githubBase}/docs/JUDGE_DEMO.md`}>View technical proof</a>
          </div>
          <div className={styles.truthStrip} aria-label="Product runtime summary">
            <span><b>Persistent</b> wallet-scoped control plane</span>
            <span><b>Proven</b> Solana devnet channel lifecycle</span>
            <span><b>Guarded</b> external execution until signer runtime exists</span>
          </div>
        </div>

        <div className={styles.flowCard} aria-label="Bounded agent payment flow">
          <div className={styles.flowHead}><span>Task payment envelope</span><b>$1.00 USDC example</b></div>
          <FlowStep index="01" title="Authorize" detail="Owner approves budget + policy" amount="$1.00 cap" />
          <FlowStep index="02" title="Route" detail="Provider calls pass policy first" amount="≤ $0.25/call" />
          <FlowStep index="03" title="Accumulate" detail="Offchain cumulative authorization" amount="$0.20 used" />
          <FlowStep index="04" title="Settle + recover" detail="Pay actual usage; return remainder" amount="$0.80 back" positive />
          <small>Illustrative task economics. Real transaction signatures are shown only when genuine chain evidence exists.</small>
        </div>
      </section>

      <section className={styles.model} id="model">
        <div className={styles.sectionIntro}>
          <span>Why this exists</span>
          <h2>Autonomy should not mean giving software an unbounded wallet.</h2>
          <p>Machine workflows can trigger many small paid calls. Canalis keeps those calls fast while preserving a financial mandate the agent cannot silently expand.</p>
        </div>
        <div className={styles.modelGrid}>
          <article><strong>1</strong><div><h3>Bound the mandate</h3><p>Set total ceiling, per-call cap, provider allowlist, provider caps, networks, assets, protocols, and expiry.</p></div></article>
          <article><strong>2</strong><div><h3>Authorize before fulfillment</h3><p>A paid provider flow is checked against the task policy before Canalis accepts the resulting work and receipt.</p></div></article>
          <article><strong>3</strong><div><h3>Settle only actual usage</h3><p>Cumulative authorization can be finalized through the Solana payment-channel boundary while unused capacity remains attributable to payer recovery.</p></div></article>
        </div>
      </section>

      <section className={styles.capabilities} id="capabilities">
        <div className={styles.sectionIntro}>
          <span>Product surface</span>
          <h2>A control plane for the full payment lifecycle.</h2>
        </div>
        <div className={styles.capabilityGrid}>
          <article><span>POLICY</span><h3>Reusable spending rules</h3><p>Versioned policies and task snapshots keep caps, providers, assets, networks, and protocols explicit.</p><Link href="/policies">Policies →</Link></article>
          <article><span>ROUTING</span><h3>Provider registry</h3><p>Configure deterministic, x402, and MPP providers with health, pricing, credentials, and runtime-readiness checks.</p><Link href="/providers">Providers →</Link></article>
          <article><span>EVIDENCE</span><h3>Receipts + transactions</h3><p>Trace offchain authorization, response hashes, settlement signatures, distribution, and payer recovery in one audit view.</p><Link href="/transactions">Transactions →</Link></article>
          <article><span>OPERATIONS</span><h3>Guided recovery</h3><p>Provider incidents, ambiguous finalization, recoverable escrow, and settlement failures surface with safe next actions.</p><Link href="/activity">Activity →</Link></article>
        </div>
      </section>

      <section className={styles.proof} id="proof">
        <div className={styles.proofCopy}>
          <span className={styles.kicker}><i />Real Solana devnet evidence</span>
          <h2>The payment-channel primitive is proven without fabricated signatures.</h2>
          <p>The committed proof opens a channel with a 100,000-unit ceiling, settles 30,000 units to the provider, and returns the remaining 70,000 units to the payer. These are devnet proof values—not a claim that every configured external provider is autonomously executable today.</p>
          <div className={styles.proofLinks}>
            <a href={explorerAddress(devnetProof.channel)} target="_blank" rel="noreferrer">Channel {shortAddress(devnetProof.channel)} ↗</a>
            <a href={explorerTx(devnetProof.settleSignature)} target="_blank" rel="noreferrer">Settlement transaction ↗</a>
            <a href={`${githubBase}/docs/settlement-finalization.md`}>Finalization contract ↗</a>
          </div>
        </div>
        <div className={styles.ledger}>
          <LedgerRow label="Channel ceiling" value="100,000" />
          <LedgerRow label="Provider settlement" value="30,000" />
          <LedgerRow label="Returned to payer" value="70,000" positive />
          <div className={styles.ledgerFoot}><span>Network</span><strong>Solana devnet</strong></div>
        </div>
      </section>

      <section className={styles.runtimeTruth}>
        <div><span>Runtime truth</span><h2>Canalis separates configuration from execution capability.</h2></div>
        <div className={styles.truthCards}>
          <article><b>Available now</b><p>Wallet-scoped tasks, policies, providers, analytics, receipts, activity, recovery, deterministic execution, and the proven devnet payment-channel path.</p></article>
          <article><b>Configuration-ready</b><p>External x402 and MPP endpoints can be registered and protocol-health-checked without code changes.</p></article>
          <article><b>Intentionally blocked</b><p>External autonomous spending and mainnet task creation remain blocked until an appropriate non-custodial signer/session runtime is connected.</p></article>
        </div>
      </section>

      <section className={styles.finalCta}>
        <div><span>Start with the mandate</span><h2>Set the provider path. Define the policy. Create the task.</h2></div>
        <div><Link className={styles.primary} href="/onboarding">Open setup guide <span>→</span></Link><Link className={styles.secondary} href="/dashboard">Returning operator</Link></div>
      </section>

      <footer className={styles.footer}>
        <div><CanalisLogo /><p>Governed payment orchestration for autonomous agents on Solana.</p></div>
        <ProductStatus />
        <div><a href="https://github.com/EcstaceeLOR/Canalis">GitHub</a><a href={`${githubBase}/docs/ARCHITECTURE.md`}>Architecture</a><Link href="/onboarding">Get started</Link></div>
      </footer>
    </main>
  );
}

function FlowStep({ index, title, detail, amount, positive = false }: { index: string; title: string; detail: string; amount: string; positive?: boolean }) {
  return <div className={styles.flowStep}><span>{index}</span><div><strong>{title}</strong><small>{detail}</small></div><b className={positive ? styles.positive : ""}>{amount}</b></div>;
}

function LedgerRow({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return <div className={styles.ledgerRow}><span>{label}</span><strong className={positive ? styles.positive : ""}>{value}</strong></div>;
}
