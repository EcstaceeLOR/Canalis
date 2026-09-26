import type { Metadata } from "next";
import { DeveloperWorkspace } from "../../../components/product/developer-workspace";

export const metadata: Metadata = {
  title: "Developers",
  description: "Manage Canalis API keys, webhook subscriptions, delivery retries, and SDK integration.",
};

export default function DevelopersPage() {
  return <DeveloperWorkspace />;
}
