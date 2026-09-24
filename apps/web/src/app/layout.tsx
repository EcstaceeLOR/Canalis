import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Canalis — Payment orchestration for autonomous agents",
  description:
    "Give an agent a budget. Canalis controls, routes, records, and settles what it pays for on Solana.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
