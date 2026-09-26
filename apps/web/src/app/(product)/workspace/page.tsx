import type { Metadata } from "next";
import { WorkspaceManagement } from "../../../components/product/workspace-management";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Manage Canalis workspace members, roles, invitations, and signing authority.",
};

export default function WorkspacePage() {
  return <WorkspaceManagement />;
}
