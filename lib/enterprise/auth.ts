/**
 * Enterprise authentication middleware.
 *
 * Supports pluggable auth modes via PI_AUTH_MODE env:
 *   - "token" (default): simple bearer token check against PI_AUTH_TOKEN
 *   - "oidc": OIDC/SSO token validation (requires PI_OIDC_ISSUER, PI_OIDC_AUDIENCE)
 *
 * All enterprise API routes should call `authenticateRequest()` before processing.
 */

export const ENTERPRISE_AUTH_COOKIE = "pi_enterprise_session";

// ── Types ──────────────────────────────────────────────────────────────

export interface AuthenticatedUser {
  id: string;
  email?: string;
  name?: string;
  organizationId?: string;
  roles?: string[];
}

export interface AuthResult {
  ok: true;
  user: AuthenticatedUser;
}

export interface AuthFailure {
  ok: false;
  status: number;
  error: string;
}

export type AuthResponse = AuthResult | AuthFailure;

// ── Config ─────────────────────────────────────────────────────────────

const AUTH_MODE = (process.env.PI_AUTH_MODE ?? "oidc").toLowerCase();
const STATIC_TOKEN = process.env.PI_AUTH_TOKEN ?? "";

// OIDC config (only used when AUTH_MODE=oidc)
const OIDC_ISSUER = process.env.PI_OIDC_ISSUER ?? "";
const OIDC_AUDIENCE = process.env.PI_OIDC_AUDIENCE ?? "";
const OIDC_ROLES_CLAIM = process.env.PI_OIDC_ROLES_CLAIM ?? "roles";

// ── Token auth ─────────────────────────────────────────────────────────

async function authenticateToken(authHeader: string | null): Promise<AuthResponse> {
  if (!STATIC_TOKEN) {
    // No token configured — allow all (dev mode)
    return { ok: true, user: { id: "dev-user" } };
  }

  if (!authHeader) {
    return { ok: false, status: 401, error: "Authorization header required" };
  }

  const [scheme, token] = authHeader.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return { ok: false, status: 401, error: "Bearer token required" };
  }

  if (token !== STATIC_TOKEN) {
    return { ok: false, status: 403, error: "Invalid token" };
  }

  // Load roles from PG if available
  let roles: string[] | undefined;
  let organizationId: string | undefined;
  try {
    const { getEnterpriseDb } = await import("./db");
    const db = await getEnterpriseDb().catch(() => null);
    if (db) {
      const result = await db.query(
        "SELECT organization_id, roles FROM enterprise_users WHERE id = $1 LIMIT 1",
        ["token-user"]
      ).catch(() => null);
      if (result?.rows[0]) {
        organizationId = result.rows[0].organization_id as string;
        roles = result.rows[0].roles as string[];
      }
    }
  } catch { /* ignore */ }

  return { ok: true, user: { id: "token-user", organizationId, roles } };
}

// ── OIDC auth (with jose for full signature verification) ────────────

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

let _jwksPromise: Promise<ReturnType<typeof createRemoteJWKSet>> | null = null;

async function getJwks(issuer: string): Promise<ReturnType<typeof createRemoteJWKSet>> {
  if (_jwksPromise) return _jwksPromise;
  _jwksPromise = (async () => {
    const discoveryUrl = new URL(".well-known/openid-configuration", `${issuer.replace(/\/$/, "")}/`);
    const response = await fetch(discoveryUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`OIDC discovery failed with status ${response.status}`);
    }
    const metadata = await response.json() as { jwks_uri?: unknown };
    if (typeof metadata.jwks_uri !== "string" || !metadata.jwks_uri) {
      throw new Error("OIDC discovery response is missing jwks_uri");
    }
    return createRemoteJWKSet(new URL(metadata.jwks_uri));
  })();
  try {
    return await _jwksPromise;
  } catch (error) {
    _jwksPromise = null;
    throw error;
  }
}

interface OidcClaims extends JWTPayload {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  org_id?: string;
  organization?: string;
  roles?: string[];
}

async function authenticateOidc(authHeader: string | null): Promise<AuthResponse> {
  if (!OIDC_ISSUER) {
    return { ok: false, status: 500, error: "OIDC not configured (PI_OIDC_ISSUER required)" };
  }

  if (!authHeader) {
    return { ok: false, status: 401, error: "Authorization header required" };
  }

  const [scheme, token] = authHeader.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return { ok: false, status: 401, error: "Bearer token required" };
  }

  try {
    const jwks = await getJwks(OIDC_ISSUER);
    const verifyOptions: Record<string, unknown> = { issuer: OIDC_ISSUER };
    if (OIDC_AUDIENCE) verifyOptions.audience = OIDC_AUDIENCE;

    const { payload } = await jwtVerify<OidcClaims>(token, jwks, verifyOptions);

    const user: AuthenticatedUser = {
      id: payload.sub ?? "unknown",
      email: payload.email,
      name: payload.name ?? payload.preferred_username,
      organizationId: payload.org_id ?? payload.organization,
      roles: Array.isArray(payload[OIDC_ROLES_CLAIM]) ? (payload[OIDC_ROLES_CLAIM] as string[]) : undefined,
    };

    return { ok: true, user };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Token verification failed";
    return { ok: false, status: 401, error: `OIDC verification failed: ${msg}` };
  }
}


// ── Public API ─────────────────────────────────────────────────────────

/**
 * Authenticate a request. Returns the authenticated user or an error response.
 *
 * Usage in API routes:
 * ```
 * const auth = await authenticateRequest(req);
 * if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
 * const user = auth.user;
 * ```
 */
export async function authenticateRequest(req: Request): Promise<AuthResponse> {
  const authHeader = req.headers.get("authorization") ?? getCookieAuthorization(req);

  switch (AUTH_MODE) {
    case "oidc":
      return authenticateOidc(authHeader);
    case "token":
    default:
      return authenticateToken(authHeader);
  }
}

function getCookieAuthorization(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    if (name !== ENTERPRISE_AUTH_COOKIE) continue;
    const value = item.slice(separator + 1).trim();
    if (!value) return null;
    try {
      return `Bearer ${decodeURIComponent(value)}`;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Get the current auth mode (for UI hints).
 */
export function getAuthMode(): string {
  return AUTH_MODE;
}

/**
 * Check if auth is effectively disabled (no token configured in token mode).
 */
export function isAuthDisabled(): boolean {
  return AUTH_MODE === "token" && !STATIC_TOKEN;
}
