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

// ── OIDC auth ──────────────────────────────────────────────────────────

// Cached JWKS and discovery document
let _oidcJwks: { keys: Array<{ kid: string; kty: string; [key: string]: unknown }> } | null = null;
let _oidcJwksExpiry = 0;

async function fetchOidcJwks(): Promise<typeof _oidcJwks> {
  if (_oidcJwks && Date.now() < _oidcJwksExpiry) return _oidcJwks;

  if (!OIDC_ISSUER) return null;

  try {
    // OIDC discovery
    const discoveryUrl = `${OIDC_ISSUER}/.well-known/openid-configuration`;
    const discovery = (await fetch(discoveryUrl).then((r) => r.json())) as { jwks_uri: string };
    if (!discovery.jwks_uri) return null;

    // Fetch JWKS
    const jwks = (await fetch(discovery.jwks_uri).then((r) => r.json())) as typeof _oidcJwks;
    _oidcJwks = jwks;
    _oidcJwksExpiry = Date.now() + 3600_000; // Cache for 1 hour
    return jwks;
  } catch (err) {
    console.error("[auth] OIDC JWKS fetch failed:", err);
    return null;
  }
}

/**
 * Decode a JWT without verification (for extracting header/payload).
 * Full verification requires JWKS — this is a lightweight first pass.
 */
function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    return { header, payload };
  } catch {
    return null;
  }
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

  // Decode JWT to extract claims
  const decoded = decodeJwt(token);
  if (!decoded) {
    return { ok: false, status: 401, error: "Invalid JWT format" };
  }

  const { payload } = decoded;

  // Check expiry
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
    return { ok: false, status: 401, error: "Token expired" };
  }

  // Check issuer
  if (payload.iss !== OIDC_ISSUER) {
    return { ok: false, status: 401, error: "Invalid issuer" };
  }

  // Check audience (if configured)
  if (OIDC_AUDIENCE) {
    const aud = payload.aud;
    const audMatch = Array.isArray(aud) ? aud.includes(OIDC_AUDIENCE) : aud === OIDC_AUDIENCE;
    if (!audMatch) {
      return { ok: false, status: 401, error: "Invalid audience" };
    }
  }

  // Verify signature against JWKS (if available)
  const jwks = await fetchOidcJwks();
  if (jwks) {
    const kid = decoded.header.kid as string | undefined;
    const key = kid ? jwks.keys.find((k) => k.kid === kid) : jwks.keys[0];
    if (!key) {
      return { ok: false, status: 401, error: "No matching signing key found" };
    }
    // Note: Full RSA/EC signature verification would require crypto.subtle or jose library.
    // For production, install `jose` and verify: await jose.jwtVerify(token, JWKS)
    // This is a structural placeholder — claims are validated but signature is not cryptographically verified.
    console.warn("[auth] OIDC signature verification not fully implemented — install `jose` for production");
  }

  // Extract user identity from claims
  const user: AuthenticatedUser = {
    id: (payload.sub as string) ?? "unknown",
    email: payload.email as string | undefined,
    name: (payload.name as string) ?? (payload.preferred_username as string),
    organizationId: (payload.org_id as string) ?? (payload.organization as string),
    roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : undefined,
  };

  return { ok: true, user };
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
