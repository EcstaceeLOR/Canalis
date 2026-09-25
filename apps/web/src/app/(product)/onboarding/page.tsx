import type { Metadata } from "next";
import { OnboardingWorkspace } from "../../../components/product/onboarding-workspace";

export const metadata: Metadata = {
  title: "Get started",
  description: "Configure a provider path, reusable spending policy, and your first governed Canalis task.",
};

export default function OnboardingPage() {
  return <OnboardingWorkspace />;
}
