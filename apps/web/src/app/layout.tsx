import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ProductEdgeGuards } from "../components/product/product-edge-guards";
import { CANONICAL_SITE_URL } from "../lib/release";
import "./globals.css";
import "./design-system.css";
import "./design-system-states.css";
import "./product.css";
import "./wallet.css";
import "./tasks.css";
import "./task-detail.css";
import "./production-ux.css";

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_SITE_URL),
  applicationName: "Canalis",
  title: { default: "Canalis — Governed payments for autonomous agents", template: "%s · Canalis" },
  description: "Canalis gives autonomous agents bounded budgets, policy-controlled payment routes, auditable receipts, and Solana payment-channel settlement.",
  keywords: ["Canalis", "Solana", "payment channels", "autonomous agents", "agent payments"],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
  },
  openGraph: {
    siteName: "Canalis",
    title: "Canalis — Governed payments for autonomous agents",
    description: "Bound an agent budget, route paid machine-service calls under policy, settle cumulative usage on Solana, and recover what was not spent.",
    url: CANONICAL_SITE_URL,
    type: "website",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Canalis governed agent payments" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Canalis — Governed payments for autonomous agents",
    description: "Bounded budgets, policy-controlled machine-service payments, auditable receipts, and Solana payment-channel settlement.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><ProductEdgeGuards />{children}</body></html>;
}
