import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function requireText(path, patterns) {
  const source = read(path);
  for (const pattern of patterns) {
    if (!source.includes(pattern)) {
      throw new Error(`${path} is missing required workspace contract: ${pattern}`);
    }
  }
}

requireText("packages/application/src/workspace.ts", [
  '"owner"',
  '"admin"',
  '"operator"',
  '"viewer"',
  '"members:manage"',
  '"tasks:execute"',
  '"developers:write"',
]);

requireText("packages/persistence/migrations/0011_team_workspaces.sql", [
  "CREATE TABLE IF NOT EXISTS workspaces",
  "CREATE TABLE IF NOT EXISTS workspace_members",
  "CREATE TABLE IF NOT EXISTS workspace_invitations",
  "workspace_id",
  "canalis_assign_workspace_id",
  "developer_api_keys",
  "webhook_subscriptions",
  "audit_events_workspace_idx",
]);

requireText("apps/web/src/server/auth.ts", [
  "resolveWorkspaceIdentity",
  "assertRequestWorkspacePermission",
  "signingWalletAddress",
]);

requireText("apps/web/src/server/workspaces.ts", [
  "WORKSPACE_SIGNER_REQUIRED",
  '"members:manage"',
  "requested.strict",
  "workspaceRolePermissions",
]);

requireText("apps/web/src/components/product/app-shell.tsx", [
  'href: "/workspace"',
  "WorkspaceSwitcher",
]);
requireText("apps/web/src/app/(product)/workspace/page.tsx", ["WorkspaceManagement"]);
requireText("apps/web/src/components/product/workspace-management.tsx", [
  "Signing wallet",
  "Permission model",
  "Your pending invitations",
]);
requireText("packages/persistence/test/workspaces.integration.test.ts", [
  "multi-workspace membership",
  "keeps task reads isolated",
]);
requireText("apps/web/src/server/workspaces.test.ts", [
  "blocks viewer mutations",
  "signer-only channel finalization",
]);

console.log("Team workspace contracts verified.");
