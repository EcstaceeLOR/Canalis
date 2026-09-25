import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./design-system.css";
import "./design-system-states.css";
import "./product.css";
import "./wallet.css";
import "./tasks.css";
import "./task-detail.css";

export const metadata: Metadata = {
  applicationName: "Canalis",
  title: { default: "Canalis — Governed payments for autonomous agents", template: "%s · Canalis" },
  description: "Canalis gives autonomous agents bounded budgets, policy-controlled payment routes, auditable receipts, and Solana payment-channel settlement.",
  keywords: ["Canalis", "Solana", "payment channels", "autonomous agents", "agent payments"],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
