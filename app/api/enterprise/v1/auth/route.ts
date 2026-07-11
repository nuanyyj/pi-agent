import { NextResponse } from "next/server";
import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getAuthMode, isAuthDisabled, authenticateRequest } from "@/lib/enterprise/auth";

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

  // If an Authorization header is provided, validate it
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
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

  return NextResponse.json({
    mode,
    disabled,
    authenticated: disabled, // auto-authenticated when auth is disabled
  });
}
