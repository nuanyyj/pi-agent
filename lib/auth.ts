/**
 * Authentication and authorization utilities for pi-web.
 *
 * When PI_AUTH_TOKEN is set, all API requests must include a valid
 * Bearer token or session cookie. When unset, auth is disabled (local
 * dev mode). Enterprise deployments MUST set this.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

const AUTH_TOKEN = process.env.PI_AUTH_TOKEN;
const SESSION_COOKIE = "pi-session";

// In-memory session store: token -> expiry timestamp
declare global {
  var __piAuthSessions: Map<string, number> | undefined;
}

function getSessions(): Map<string, number> {
  if (!globalThis.__piAuthSessions) globalThis.__piAuthSessions = new Map();
  return globalThis.__piAuthSessions;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function isAuthEnabled(): boolean {
  return Boolean(AUTH_TOKEN);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Validate a Bearer token against the configured PI_AUTH_TOKEN.
 */
function validateBearerToken(token: string): boolean {
  if (!AUTH_TOKEN) return true;
  return safeEqual(token, AUTH_TOKEN);
}

/**
 * Create a new session token. Returns the token to set as a cookie.
 */
export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  getSessions().set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

/**
 * Validate a session cookie token.
 */
function validateSessionToken(token: string): boolean {
  if (!AUTH_TOKEN) return true;
  const expiry = getSessions().get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    getSessions().delete(token);
    return false;
  }
  return true;
}

/**
 * Extract and validate auth from a request.
 * Returns true if the request is authorized.
 */
export function validateRequest(req: Request): boolean {
  if (!AUTH_TOKEN) return true;

  // Check Authorization header
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token && validateBearerToken(token)) return true;
  }

  // Check session cookie
  const cookie = req.headers.get("cookie");
  if (cookie) {
    const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    if (match?.[1] && validateSessionToken(match[1])) return true;
  }

  return false;
}

/**
 * Login endpoint handler: validates credentials and returns a session token.
 */
export function handleLogin(password: string): { ok: boolean; token?: string } {
  if (!AUTH_TOKEN) return { ok: true };
  if (!password || !safeEqual(password, AUTH_TOKEN)) return { ok: false };
  return { ok: true, token: createSession() };
}

/**
 * Clean up expired sessions. Call periodically.
 */
export function purgeExpiredSessions(): void {
  const now = Date.now();
  const sessions = getSessions();
  for (const [token, expiry] of sessions) {
    if (now > expiry) sessions.delete(token);
  }
}

