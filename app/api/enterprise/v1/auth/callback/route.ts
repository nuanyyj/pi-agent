import { NextResponse } from "next/server";
import { ENTERPRISE_AUTH_COOKIE } from "@/lib/enterprise/auth";
import { createAuthSession } from "@/lib/enterprise/auth-session";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { completeOidcAuthorization, getOidcPublicOrigin } from "@/lib/enterprise/oidc";

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  let publicOrigin: string;
  try {
    publicOrigin = getOidcPublicOrigin();
  } catch {
    return NextResponse.json({ error: "OIDC authentication is not configured" }, { status: 500 });
  }
  const errorRedirect = new URL("/?authError=oidc_callback_failed", publicOrigin);
  if (!isEnterpriseEnabled()) return NextResponse.redirect(errorRedirect);

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  if (!code || !state || requestUrl.searchParams.has("error")) {
    return NextResponse.redirect(errorRedirect);
  }

  try {
    const db = await getEnterpriseDb();
    if (!db) return NextResponse.redirect(errorRedirect);
    const completed = await completeOidcAuthorization(db, {
      code,
      state,
      requestOrigin: requestUrl.origin,
    });
    const session = await createAuthSession(db, completed.user);
    const maxAge = Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000));
    const response = NextResponse.redirect(new URL(completed.returnTo, publicOrigin));
    response.cookies.set(ENTERPRISE_AUTH_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge,
    });
    return response;
  } catch {
    return NextResponse.redirect(errorRedirect);
  }
}
