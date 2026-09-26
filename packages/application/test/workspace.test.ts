import { describe, expect, it } from "vitest";
import {
  assertWorkspacePermission,
  workspaceRoleHasPermission,
  workspaceRolePermissions,
} from "../src/workspace.js";

describe("workspace role permissions", () => {
  it("keeps viewers read-only", () => {
    expect(workspaceRoleHasPermission("viewer", "tasks:read")).toBe(true);
    expect(workspaceRoleHasPermission("viewer", "tasks:write")).toBe(false);
    expect(workspaceRoleHasPermission("viewer", "members:manage")).toBe(false);
    expect(() => assertWorkspacePermission("viewer", "providers:write")).toThrow(/does not allow providers:write/);
  });

  it("lets operators run work without administering the tenant", () => {
    expect(workspaceRoleHasPermission("operator", "tasks:write")).toBe(true);
    expect(workspaceRoleHasPermission("operator", "tasks:execute")).toBe(true);
    expect(workspaceRoleHasPermission("operator", "channels:write")).toBe(true);
    expect(workspaceRoleHasPermission("operator", "developers:write")).toBe(false);
    expect(workspaceRoleHasPermission("operator", "members:manage")).toBe(false);
  });

  it("gives admins management rights while reserving owner as a distinct role", () => {
    expect(workspaceRolePermissions.admin).toContain("members:manage");
    expect(workspaceRolePermissions.admin).toContain("settings:write");
    expect(workspaceRolePermissions.owner).toEqual(workspaceRolePermissions.admin);
  });
});
