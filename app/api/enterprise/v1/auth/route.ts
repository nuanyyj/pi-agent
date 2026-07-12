import { NextResponse } from "next/server";
import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import {
  ENTERPRISE_AUTH_COOKIE,
  getSessionCookie,
  getAuthMode,
  isAuthDisabled,
  authenticateRequest,
} from "@/lib/enterprise/auth";

/**
 * GET /api/enterprise/v1/auth
 * Returns the current authentication mode and status.
 * Also serves as a token validation endpoint — pass Authorization header to verify.
 */
export async function GET(req: Request) {
  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  const mode = getAuthMode();
  const disabled = isAuthDisabled();

  const auth = await authenticateRequest(req);
  if (auth.ok) {
    return NextResponse.json({
      mode,
      disabled,
      authenticated: true,
      user: auth.user,
    });
  }

  return NextResponse.json({
    mode,
    disabled,
    authenticated: false,
    error: auth.error,
  }, { status: auth.status });
}

/** Validate a bearer token once, then establish a same-origin HttpOnly session. */
export async function POST(req: Request) {
  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }
  if (getAuthMode() === "oidc") {
    return NextResponse.json(
      { error: "Use the OIDC login endpoint" },
      { status: 405, headers: { Allow: "GET, DELETE" } },
    );
  }
  const authorization = req.headers.get("authorization");
  if (!authorization) {
    return NextResponse.json({ error: "Authorization header required" }, { status: 401 });
  }
  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const token = authorization.split(" ", 2)[1];
  if (!token) return NextResponse.json({ error: "Bearer token required" }, { status: 401 });

  const response = NextResponse.json({
    mode: getAuthMode(),
    disabled: isAuthDisabled(),
    authenticated: true,
    user: auth.user,
  });
  response.cookies.set(ENTERPRISE_AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return response;
}

export async function DELETE(req: Request) {
  const token = getSessionCookie(req);
  if (token) {
    try {
      const [{ getEnterpriseDb }, { revokeAuthSession }] = await Promise.all([
        import("@/lib/enterprise/db"),
        import("@/lib/enterprise/auth-session"),
      ]);
      const db = await getEnterpriseDb();
      if (db) await revokeAuthSession(db, token);
    } catch {
      // Always clear the browser cookie. A database outage must not trap the
      // user in an unusable local session; the server row still expires.
    }
  }
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(ENTERPRISE_AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
