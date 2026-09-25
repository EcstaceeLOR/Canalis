import type { ReactNode } from "react";
import { AppShell } from "../../components/product/app-shell";
import { OnboardingGuide } from "../../components/product/onboarding-guide";
import { WalletIdentityProvider } from "../../components/wallet/wallet-identity";

export default function ProductLayout({ children }: { children: ReactNode }) {
  return (
    <WalletIdentityProvider>
      <AppShell>
        <OnboardingGuide />
        {children}
      </AppShell>
    </WalletIdentityProvider>
  );
}
