import { PageHeader } from "../../../components/product/page-header";
import { SettingsWorkspace } from "../../../components/product/settings-workspace";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return <div className="page-stack">
    <PageHeader
      eyebrow="Configuration"
      title="Settings & integrations"
      description="Configure the active Solana environment, task defaults, product preferences, and verified external payment adapters without exposing secrets to the browser."
    />
    <SettingsWorkspace />
  </div>;
}
