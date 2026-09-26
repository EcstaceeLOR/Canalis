import { randomUUID } from "node:crypto";
import {
  ApplicationError,
  assertWorkspacePermission,
  parseWorkspaceInvite,
  parseWorkspaceRename,
  parseWorkspaceRoleUpdate,
  workspaceRolePermissions,
  type WalletSessionIdentity,
  type WorkspacePermission,
  type WorkspaceSessionIdentity,
} from "@canalis/application";
import { PostgresWorkspaceRepository } from "@canalis/persistence";
import { getCanalisApplication } from "./canalis";

export const CANALIS_WORKSPACE_COOKIE = "canalis_workspace";

let repository: PostgresWorkspaceRepository | undefined;
let initialization: Promise<PostgresWorkspaceRepository> | undefined;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new ApplicationError("STORAGE_NOT_CONFIGURED", "Canalis durable storage is not configured.", 503);
  return value;
}

export async function getWorkspaceRepository(): Promise<PostgresWorkspaceRepository> {
  if (repository) return repository;
  if (!initialization) {
    initialization = (async () => {
      await getCanalisApplication();
      repository = new PostgresWorkspaceRepository(databaseUrl());
      return repository;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("cookie");
  if (!cookie) return undefined;
  for (const entry of cookie.split(";")) {
    const [rawName, ...rawValue] = entry.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}

function requestedWorkspace(request: Request): { id?: string; strict: boolean } {
  const header = request.headers.get("x-canalis-workspace-id")?.trim();
  if (header) return { id: header, strict: true };
  const cookie = cookieValue(request, CANALIS_WORKSPACE_COOKIE)?.trim();
  return { ...(cookie ? { id: cookie } : {}), strict: false };
}

export async function resolveWorkspaceIdentity(
  request: Request,
  identity: WalletSessionIdentity,
): Promise<WorkspaceSessionIdentity> {
  const store = await getWorkspaceRepository();
  await store.ensurePersonalWorkspace(identity.walletAddress);
  const memberships = await store.listForWallet(identity.walletAddress);
  const requested = requestedWorkspace(request);
  const fallbackId = memberships[0]?.id;
  if (!fallbackId) throw new ApplicationError("WORKSPACE_NOT_FOUND", "No workspace is available for this wallet.", 404);

  let selectedId = requested.id ?? fallbackId;
  let record = await store.getForMember(selectedId, identity.walletAddress);
  if (!record && requested.id && requested.strict) {
    throw new ApplicationError("WORKSPACE_ACCESS_DENIED", "You do not have access to the requested workspace.", 403);
  }
  if (!record) {
    selectedId = fallbackId;
    record = await store.getForMember(selectedId, identity.walletAddress);
  }
  if (!record) throw new ApplicationError("WORKSPACE_NOT_FOUND", "No accessible workspace is available for this wallet.", 404);

  return {
    walletAddress: record.workspace.signingWallet,
    actorWalletAddress: identity.walletAddress,
    network: identity.network,
    expiresAtUnixSeconds: identity.expiresAtUnixSeconds,
    workspaceId: record.workspace.id,
    workspaceName: record.workspace.name,
    workspaceRole: record.membership.role,
    signingWalletAddress: record.workspace.signingWallet,
    isSigningWallet: record.workspace.signingWallet === identity.walletAddress,
    permissions: [...workspaceRolePermissions[record.membership.role]],
  };
}

export function requiredPermissionForRequest(request: Request): WorkspacePermission | null {
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return "workspace:read";
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/providers")) return "providers:write";
  if (path.startsWith("/api/policies")) return "policies:write";
  if (path.startsWith("/api/settings") || path.startsWith("/api/onboarding")) return "settings:write";
  if (path.startsWith("/api/developer")) return "developers:write";
  if (path.startsWith("/api/activity")) return "activity:write";
  if (/\/api\/tasks\/[^/]+\/execute$/.test(path)) return "tasks:execute";
  if (path.startsWith("/api/tasks") || path.startsWith("/api/demo")) return "tasks:write";
  if (path.startsWith("/api/channels")) return "channels:write";
  return "workspace:read";
}

export function assertRequestWorkspacePermission(request: Request, identity: WorkspaceSessionIdentity): void {
  const permission = requiredPermissionForRequest(request);
  if (permission) assertWorkspacePermission(identity.workspaceRole, permission);
  const path = new URL(request.url).pathname;
  const signingAction = request.method !== "GET" && (
    path.includes("/live/") ||
    /\/api\/channels\/[^/]+\/[^/]+\/action$/.test(path)
  );
  if (signingAction && !identity.isSigningWallet) {
    throw new ApplicationError(
      "WORKSPACE_SIGNER_REQUIRED",
      `This action must be authorized by workspace signing wallet ${identity.signingWalletAddress}.`,
      403,
      { signingWallet: identity.signingWalletAddress },
    );
  }
}

export async function workspaceOverview(actorWallet: string) {
  const store = await getWorkspaceRepository();
  await store.ensurePersonalWorkspace(actorWallet);
  return {
    workspaces: await store.listForWallet(actorWallet),
    invitations: await store.listPendingInvitationsForWallet(actorWallet),
  };
}

export async function workspaceDetails(workspaceId: string, actorWallet: string) {
  const store = await getWorkspaceRepository();
  const access = await store.getForMember(workspaceId, actorWallet);
  if (!access) throw new ApplicationError("WORKSPACE_ACCESS_DENIED", "You do not have access to this workspace.", 403);
  return {
    workspace: access.workspace,
    membership: access.membership,
    permissions: workspaceRolePermissions[access.membership.role],
    members: await store.listMembers(workspaceId),
    invitations: await store.listInvitations(workspaceId),
    signing: {
      requiredWallet: access.workspace.signingWallet,
      connectedWallet: actorWallet,
      canSign: access.workspace.signingWallet === actorWallet,
    },
  };
}

export async function renameWorkspace(workspaceId: string, actorWallet: string, input: unknown) {
  const store = await getWorkspaceRepository();
  const access = await store.getForMember(workspaceId, actorWallet);
  if (!access) throw new ApplicationError("WORKSPACE_ACCESS_DENIED", "You do not have access to this workspace.", 403);
  assertWorkspacePermission(access.membership.role, "settings:write");
  const parsed = parseWorkspaceRename(input);
  const updated = await store.rename(workspaceId, actorWallet, parsed.name);
  if (!updated) throw new ApplicationError("WORKSPACE_NOT_FOUND", "Workspace not found.", 404);
  return updated;
}

export async function inviteWorkspaceMember(workspaceId: string, actorWallet: string, input: unknown) {
  const store = await getWorkspaceRepository();
  const access = await store.getForMember(workspaceId, actorWallet);
  if (!access) throw new ApplicationError("WORKSPACE_ACCESS_DENIED", "You do not have access to this workspace.", 403);
  assertWorkspacePermission(access.membership.role, "members:manage");
  const parsed = parseWorkspaceInvite(input);
  if (parsed.walletAddress === access.workspace.signingWallet) {
    throw new ApplicationError("WORKSPACE_INVITE_CONFLICT", "The signing wallet is already the workspace owner.", 409);
  }
  try {
    return await store.createInvitation({
      id: `wsi_${randomUUID()}`,
      workspaceId,
      signingWallet: access.workspace.signingWallet,
      walletAddress: parsed.walletAddress,
      role: parsed.role,
      invitedByWallet: actorWallet,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
  } catch (error) {
    if (error instanceof Error && (error.message === "WORKSPACE_MEMBER_EXISTS" || /workspace_invitations_pending_unique/.test(error.message))) {
      throw new ApplicationError("WORKSPACE_INVITE_CONFLICT", "That wallet is already a member or has a pending invitation.", 409);
    }
    throw error;
  }
}

export async function acceptWorkspaceInvitation(invitationId: string, actorWallet: string) {
  const member = await (await getWorkspaceRepository()).acceptInvitation(invitationId, actorWallet);
  if (!member) throw new ApplicationError("WORKSPACE_INVITE_NOT_FOUND", "Invitation was not found, expired, or belongs to another wallet.", 404);
  return member;
}

export async function updateWorkspaceMemberRole(workspaceId: string, targetWallet: string, actorWallet: string, input: unknown) {
  const store = await getWorkspaceRepository();
  const access = await store.getForMember(workspaceId, actorWallet);
  if (!access) throw new ApplicationError("WORKSPACE_ACCESS_DENIED", "You do not have access to this workspace.", 403);
  assertWorkspacePermission(access.membership.role, "members:manage");
  const parsed = parseWorkspaceRoleUpdate(input);
  const updated = await store.updateMemberRole({
    workspaceId,
    signingWallet: access.workspace.signingWallet,
    targetWallet,
    role: parsed.role,
    actorWallet,
  });
  if (!updated) throw new ApplicationError("WORKSPACE_MEMBER_NOT_FOUND", "Member was not found or is the workspace owner.", 404);
  return updated;
}

export async function removeWorkspaceMember(workspaceId: string, targetWallet: string, actorWallet: string) {
  const store = await getWorkspaceRepository();
  const access = await store.getForMember(workspaceId, actorWallet);
  if (!access) throw new ApplicationError("WORKSPACE_ACCESS_DENIED", "You do not have access to this workspace.", 403);
  assertWorkspacePermission(access.membership.role, "members:manage");
  if (targetWallet === access.workspace.signingWallet) {
    throw new ApplicationError("WORKSPACE_LAST_OWNER_REQUIRED", "The workspace signing owner cannot be removed.", 409);
  }
  const removed = await store.removeMember({ workspaceId, signingWallet: access.workspace.signingWallet, targetWallet, actorWallet });
  if (!removed) throw new ApplicationError("WORKSPACE_MEMBER_NOT_FOUND", "Workspace member was not found.", 404);
}

export async function revokeWorkspaceInvitation(workspaceId: string, invitationId: string, actorWallet: string) {
  const store = await getWorkspaceRepository();
  const access = await store.getForMember(workspaceId, actorWallet);
  if (!access) throw new ApplicationError("WORKSPACE_ACCESS_DENIED", "You do not have access to this workspace.", 403);
  assertWorkspacePermission(access.membership.role, "members:manage");
  const revoked = await store.revokeInvitation({ invitationId, workspaceId, signingWallet: access.workspace.signingWallet, actorWallet });
  if (!revoked) throw new ApplicationError("WORKSPACE_INVITE_NOT_FOUND", "Pending invitation was not found.", 404);
}

export async function resetWorkspacesForTests(): Promise<void> {
  if (initialization) { try { await initialization; } catch { /* test cleanup */ } }
  if (repository) await repository.close();
  repository = undefined;
  initialization = undefined;
}
