import { describe, expect, it } from "vitest";
import { hasPermission, hasMinRole } from "../../lib/enterprise/rbac";

describe("enterprise RBAC fail-closed behavior", () => {
  it("does not grant permissions when OIDC/token roles are missing", () => {
    expect(hasPermission({ id: "oidc-user" }, "run:read")).toBe(false);
    expect(hasPermission({ id: "token-user", roles: [] }, "config:manage")).toBe(false);
    expect(hasMinRole({ id: "oidc-user" }, "viewer")).toBe(false);
  });

  it("keeps the explicit no-auth development identity unrestricted", () => {
    expect(hasPermission({ id: "dev-user" }, "config:manage")).toBe(true);
    expect(hasMinRole({ id: "dev-user" }, "admin")).toBe(true);
  });

  it("honors declared role permissions", () => {
    expect(hasPermission({ id: "viewer", roles: ["viewer"] }, "run:read")).toBe(true);
    expect(hasPermission({ id: "viewer", roles: ["viewer"] }, "run:create")).toBe(false);
    expect(hasPermission({ id: "admin", roles: ["admin"] }, "config:manage")).toBe(true);
  });
});
