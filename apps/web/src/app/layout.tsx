import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./design-system.css";
import "./design-system-states.css";

export const metadata: Metadata = {
  applicationName: "Canalis",
  title: "Canalis — Payment orchestration for autonomous agents",
  description:
    "Give an agent a budget. Canalis controls, routes, records, and settles what it pays for on Solana.",
  keywords: [
    "Canalis",
    "Solana",
    "payment channels",
    "autonomous agents",
    "agent payments",
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
