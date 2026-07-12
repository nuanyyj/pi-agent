import { describe, expect, it } from "vitest";
import {
  hasOrganizationAccess,
  resolveOrganizationAccess,
} from "../../lib/enterprise/request-access";

describe("resolveOrganizationAccess", () => {
  it("locks an OIDC identity to its organization claim", () => {
    expect(resolveOrganizationAccess({ id: "user", organizationId: "org-a" }, "org-a"))
      .toEqual({ ok: true, organizationId: "org-a" });
    expect(resolveOrganizationAccess({ id: "user", organizationId: "org-a" }, "org-b"))
      .toEqual({ ok: false, status: 403, error: "Organization access denied" });
  });

  it("uses the requested organization in local mode and defaults safely", () => {
    expect(resolveOrganizationAccess({ id: "dev-user" }, "org-b"))
      .toEqual({ ok: true, organizationId: "org-b" });
    expect(resolveOrganizationAccess({ id: "dev-user" }))
      .toEqual({ ok: true, organizationId: "default" });
  });

  it("rejects authenticated identities that have no organization claim", () => {
    expect(resolveOrganizationAccess({ id: "oidc-user", roles: ["viewer"] }, "org-b"))
      .toEqual({ ok: false, status: 403, error: "Organization claim required" });
    expect(hasOrganizationAccess({ id: "oidc-user", roles: ["viewer"] }, "org-b"))
      .toBe(false);
  });

  it("keeps the explicit no-auth development identity unrestricted", () => {
    expect(hasOrganizationAccess({ id: "dev-user" }, "org-b")).toBe(true);
  });
});
