import type { AuthenticatedUser } from "./auth";

export type OrganizationAccess =
  | { ok: true; organizationId: string }
  | { ok: false; status: 403; error: string };

/** Resolve tenant context, enforcing an OIDC organization claim when present. */
export function resolveOrganizationAccess(
  user: AuthenticatedUser,
  requestedOrganizationId?: string | null,
): OrganizationAccess {
  if (!user.organizationId && user.id !== "dev-user") {
    return { ok: false, status: 403, error: "Organization claim required" };
  }
  if (
    user.organizationId
    && requestedOrganizationId
    && requestedOrganizationId !== user.organizationId
  ) {
    return { ok: false, status: 403, error: "Organization access denied" };
  }
  return {
    ok: true,
    organizationId: user.organizationId ?? requestedOrganizationId ?? "default",
  };
}

export function hasOrganizationAccess(
  user: AuthenticatedUser,
  organizationId: string,
): boolean {
  if (user.id === "dev-user") return true;
  return Boolean(user.organizationId) && user.organizationId === organizationId;
}
