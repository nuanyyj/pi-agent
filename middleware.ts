/**
 * Next.js middleware: protects all /api/* routes with token auth.
 *
 * When PI_AUTH_TOKEN is not set, all requests pass through (local dev mode).
 * When set, requests must carry a valid Bearer token or session cookie.
 *
 * The login endpoint (/api/auth/login) is always accessible.
 */
import { NextResponse, type NextRequest } from "next/server";

const AUTH_TOKEN = process.env.PI_AUTH_TOKEN;
const SESSION_COOKIE = "pi-session";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isAuthorized(req: NextRequest): boolean {
  if (!AUTH_TOKEN) return true;

  // Bearer token
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token && safeEqual(token, AUTH_TOKEN)) return true;
  }

  // Session cookie
  const sessionCookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (sessionCookie) {
    // Session validation happens in the route handler (lib/auth.ts)
    // Middleware only checks that a cookie exists; routes do full validation.
    return true;
  }

  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only protect API routes
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  // Login endpoint is always accessible
  if (pathname === "/api/auth/session") return NextResponse.next();

  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="pi-web"' } },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
