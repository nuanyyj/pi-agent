/**
 * Enterprise authentication middleware.
 *
 * Supports pluggable auth modes via PI_AUTH_MODE env:
 *   - "token" (default): simple bearer token check against PI_AUTH_TOKEN
 *   - "oidc": OIDC/SSO token validation (requires PI_OIDC_ISSUER, PI_OIDC_AUDIENCE)
 *
 * All enterprise API routes should call `authenticateRequest()` before processing.
 */

import type { NextResponse } from "next/server";

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

const AUTH_MODE = (process.env.PI_AUTH_MODE ?? "token").toLowerCase();
const STATIC_TOKEN = process.env.PI_AUTH_TOKEN ?? "";

// OIDC config (only used when AUTH_MODE=oidc)
const OIDC_ISSUER = process.env.PI_OIDC_ISSUER ?? "";
const OIDC_AUDIENCE = process.env.PI_OIDC_AUDIENCE ?? "";

// ── Token auth ─────────────────────────────────────────────────────────

function authenticateToken(authHeader: string | null): AuthResponse {
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

  return { ok: true, user: { id: "token-user" } };
}

// ── OIDC auth (with jose for full signature verification) ────────────

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(issuer: string) {
  if (_jwks) return _jwks;
  const jwksUrl = new URL(`${issuer}/.well-known/openid-configuration`);
  _jwks = createRemoteJWKSet(jwksUrl);
  return _jwks;
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
    const jwks = getJwks(OIDC_ISSUER);
    const verifyOptions: Record<string, unknown> = { issuer: OIDC_ISSUER };
    if (OIDC_AUDIENCE) verifyOptions.audience = OIDC_AUDIENCE;

    const { payload } = await jwtVerify<OidcClaims>(token, jwks, verifyOptions);

    const user: AuthenticatedUser = {
      id: payload.sub ?? "unknown",
      email: payload.email,
      name: payload.name ?? payload.preferred_username,
      organizationId: payload.org_id ?? payload.organization,
      roles: Array.isArray(payload.roles) ? payload.roles : undefined,
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
  const authHeader = req.headers.get("authorization");

  switch (AUTH_MODE) {
    case "oidc":
      return authenticateOidc(authHeader);
    case "token":
    default:
      return authenticateToken(authHeader);
  }
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
