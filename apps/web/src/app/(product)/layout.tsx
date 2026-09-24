import type { ReactNode } from "react";
import { AppShell } from "../../components/product/app-shell";
import { WalletIdentityProvider } from "../../components/wallet/wallet-identity";

export default function ProductLayout({ children }: { children: ReactNode }) {
  return (
    <WalletIdentityProvider>
      <AppShell>{children}</AppShell>
    </WalletIdentityProvider>
  );
}
