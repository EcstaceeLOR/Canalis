import { z } from "zod";
import { ApplicationError } from "./errors.js";
import { normalizeWalletAddress } from "./auth.js";

export const workspaceRoles = ["owner", "admin", "operator", "viewer"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export const workspacePermissions = [
  "workspace:read",
  "members:read",
  "members:manage",
  "tasks:read",
  "tasks:write",
  "tasks:execute",
  "channels:read",
  "channels:write",
  "providers:read",
  "providers:write",
  "policies:read",
  "policies:write",
  "analytics:read",
  "transactions:read",
  "activity:read",
  "activity:write",
  "integrations:read",
  "integrations:write",
  "developers:read",
  "developers:write",
  "settings:read",
  "settings:write",
] as const;
export type WorkspacePermission = (typeof workspacePermissions)[number];

const viewerPermissions: WorkspacePermission[] = [
  "workspace:read",
  "members:read",
  "tasks:read",
  "channels:read",
  "providers:read",
  "policies:read",
  "analytics:read",
  "transactions:read",
  "activity:read",
  "integrations:read",
  "developers:read",
  "settings:read",
];

const operatorPermissions: WorkspacePermission[] = [
  ...viewerPermissions,
  "tasks:write",
  "tasks:execute",
  "channels:write",
  "activity:write",
];

const adminPermissions: WorkspacePermission[] = [
  ...operatorPermissions,
  "members:manage",
  "providers:write",
  "policies:write",
  "integrations:write",
  "developers:write",
  "settings:write",
];

export const workspaceRolePermissions: Record<WorkspaceRole, readonly WorkspacePermission[]> = {
  viewer: viewerPermissions,
  operator: operatorPermissions,
  admin: adminPermissions,
  owner: adminPermissions,
};

export function workspaceRoleHasPermission(role: WorkspaceRole, permission: WorkspacePermission): boolean {
  return workspaceRolePermissions[role].includes(permission);
}

export function assertWorkspacePermission(role: WorkspaceRole, permission: WorkspacePermission): void {
  if (!workspaceRoleHasPermission(role, permission)) {
    throw new ApplicationError(
      "WORKSPACE_ROLE_REQUIRED",
      `Workspace role ${role} does not allow ${permission}.`,
      403,
      { role, requiredPermission: permission },
    );
  }
}

export type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  signingWallet: string;
  createdByWallet: string;
  createdAtUnixSeconds: string;
  updatedAtUnixSeconds: string;
};

export type WorkspaceMembershipRecord = {
  workspaceId: string;
  walletAddress: string;
  role: WorkspaceRole;
  addedByWallet: string;
  joinedAtUnixSeconds: string;
};

export type WorkspaceInvitationRecord = {
  id: string;
  workspaceId: string;
  walletAddress: string;
  role: Exclude<WorkspaceRole, "owner">;
  invitedByWallet: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAtUnixSeconds: string;
  createdAtUnixSeconds: string;
  updatedAtUnixSeconds: string;
};

export type WorkspaceSummary = WorkspaceRecord & {
  role: WorkspaceRole;
  memberCount: number;
  isSigningWallet: boolean;
};

export type WorkspaceSessionIdentity = {
  walletAddress: string;
  actorWalletAddress: string;
  network: string;
  expiresAtUnixSeconds: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRole: WorkspaceRole;
  signingWalletAddress: string;
  isSigningWallet: boolean;
  permissions: WorkspacePermission[];
};

const workspaceNameSchema = z.string().trim().min(2).max(80);
const workspaceRoleSchema = z.enum(["admin", "operator", "viewer"]);

export function parseWorkspaceRename(input: unknown): { name: string } {
  const parsed = z.object({ name: workspaceNameSchema }).strict().safeParse(input);
  if (!parsed.success) throw new ApplicationError("VALIDATION_ERROR", "Workspace name is invalid.", 400, parsed.error.flatten());
  return parsed.data;
}

export function parseWorkspaceInvite(input: unknown): { walletAddress: string; role: Exclude<WorkspaceRole, "owner"> } {
  const parsed = z.object({ walletAddress: z.unknown(), role: workspaceRoleSchema }).strict().safeParse(input);
  if (!parsed.success) throw new ApplicationError("VALIDATION_ERROR", "Workspace invitation is invalid.", 400, parsed.error.flatten());
  return { walletAddress: normalizeWalletAddress(parsed.data.walletAddress), role: parsed.data.role };
}

export function parseWorkspaceRoleUpdate(input: unknown): { role: Exclude<WorkspaceRole, "owner"> } {
  const parsed = z.object({ role: workspaceRoleSchema }).strict().safeParse(input);
  if (!parsed.success) throw new ApplicationError("VALIDATION_ERROR", "Workspace role is invalid.", 400, parsed.error.flatten());
  return parsed.data;
}
