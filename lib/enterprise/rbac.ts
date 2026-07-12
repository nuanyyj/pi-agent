/**
 * Enterprise RBAC (Role-Based Access Control).
 *
 * Roles: admin, developer, viewer
 * Permissions are checked per-route via `requirePermission()`.
 *
 * Role assignment:
 *   - OIDC mode: roles come from JWT claims (PI_OIDC_ROLES_CLAIM, default "roles")
 *   - Token mode: roles stored in enterprise_users PG table
 */

import type { AuthenticatedUser } from "./auth";

// ── Roles & Permissions ────────────────────────────────────────────────

export type Role = "admin" | "developer" | "viewer";

export type Permission =
  | "conversation:create"
  | "conversation:read"
  | "conversation:delete"
  | "run:create"
  | "run:read"
  | "run:cancel"
  | "artifact:read"
  | "artifact:write"
  | "audit:read"
  | "user:manage"
  | "config:manage";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    "conversation:create", "conversation:read", "conversation:delete",
    "run:create", "run:read", "run:cancel",
    "artifact:read", "artifact:write",
    "audit:read",
    "user:manage", "config:manage",
  ],
  developer: [
    "conversation:create", "conversation:read", "conversation:delete",
    "run:create", "run:read", "run:cancel",
    "artifact:read", "artifact:write",
    "audit:read",
  ],
  viewer: [
    "conversation:read",
    "run:read",
    "artifact:read",
    "audit:read",
  ],
};

// ── Permission checking ─────────────────────────────────────────────────

export function hasPermission(user: AuthenticatedUser, permission: Permission): boolean {
  const roles = user.roles ?? [];
  // Only the explicit no-auth development identity bypasses RBAC. Missing
  // OIDC/token roles must fail closed instead of silently becoming admin.
  if (user.id === "dev-user") return true;
  if (roles.length === 0) return false;

  return roles.some((role) => {
    const perms = ROLE_PERMISSIONS[role as Role];
    return perms?.includes(permission) ?? false;
  });
}

export function requirePermission(user: AuthenticatedUser, permission: Permission): { ok: true } | { ok: false; status: number; error: string } {
  if (hasPermission(user, permission)) return { ok: true };
  return { ok: false, status: 403, error: `Permission denied: ${permission} required` };
}

export function getRolePermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function getAllRoles(): Role[] {
  return ["admin", "developer", "viewer"];
}

/**
 * Check if a user has at least the given role level.
 * Hierarchy: admin > developer > viewer
 */
export function hasMinRole(user: AuthenticatedUser, minRole: Role): boolean {
  if (user.id === "dev-user") return true;
  const roleLevel: Record<Role, number> = { admin: 3, developer: 2, viewer: 1 };
  const userLevel = Math.max(...(user.roles ?? []).map((r) => roleLevel[r as Role] ?? 0));
  return userLevel >= roleLevel[minRole];
}
