import { describe, expect, it } from "vitest";
import type { WorkspaceSessionIdentity } from "@canalis/application";
import { assertRequestWorkspacePermission, requiredPermissionForRequest } from "./workspaces";

function identity(role: WorkspaceSessionIdentity["workspaceRole"], isSigningWallet = false): WorkspaceSessionIdentity {
  return {
    walletAddress: "signer-wallet",
    actorWalletAddress: isSigningWallet ? "signer-wallet" : "member-wallet",
    network: "solana:devnet",
    expiresAtUnixSeconds: "9999999999",
    workspaceId: "ws_test",
    workspaceName: "Test workspace",
    workspaceRole: role,
    signingWalletAddress: "signer-wallet",
    isSigningWallet,
    permissions: [],
  };
}

function request(path: string, method = "GET") {
  return new Request(`https://canalis.example${path}`, { method });
}

describe("workspace request authorization", () => {
  it("maps mutation routes to server-side permissions", () => {
    expect(requiredPermissionForRequest(request("/api/providers", "POST"))).toBe("providers:write");
    expect(requiredPermissionForRequest(request("/api/tasks/task_1/execute", "POST"))).toBe("tasks:execute");
    expect(requiredPermissionForRequest(request("/api/developer/keys", "POST"))).toBe("developers:write");
    expect(requiredPermissionForRequest(request("/api/tasks", "GET"))).toBe("workspace:read");
  });

  it("blocks viewer mutations even when the UI is bypassed", () => {
    expect(() => assertRequestWorkspacePermission(request("/api/providers", "POST"), identity("viewer")))
      .toThrow(/does not allow providers:write/);
  });

  it("allows operator task execution but not signer-only channel finalization", () => {
    expect(() => assertRequestWorkspacePermission(request("/api/tasks/task_1/execute", "POST"), identity("operator")))
      .not.toThrow();
    expect(() => assertRequestWorkspacePermission(request("/api/channels/task_1/provider_1/action", "POST"), identity("operator")))
      .toThrow(/must be authorized by workspace signing wallet/);
  });

  it("allows the signing owner to perform signer-only actions", () => {
    expect(() => assertRequestWorkspacePermission(request("/api/channels/task_1/provider_1/action", "POST"), identity("owner", true)))
      .not.toThrow();
  });
});
