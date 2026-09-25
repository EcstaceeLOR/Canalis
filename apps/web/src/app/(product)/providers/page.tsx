import { PageHeader } from "../../../components/product/page-header";
import { ProvidersWorkspace } from "../../../components/product/providers-workspace";

export const metadata = { title: "Providers" };

export default function ProvidersPage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Integrations"
        title="Providers"
        description="Configure machine-service providers, verify protocol health, control availability, and see how each provider is used across tasks and payment channels."
      />
      <ProvidersWorkspace />
    </div>
  );
}
