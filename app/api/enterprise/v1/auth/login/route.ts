import { NextResponse } from "next/server";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getAuthMode } from "@/lib/enterprise/auth";
import { createOidcAuthorizationRequest, getOidcPublicOrigin } from "@/lib/enterprise/oidc";

export async function GET(req: Request) {
  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }
  if (getAuthMode() !== "oidc") {
    return NextResponse.json({ error: "OIDC authentication is not enabled" }, { status: 400 });
  }

  try {
    const db = await getEnterpriseDb();
    if (!db) return NextResponse.json({ error: "Enterprise database not available" }, { status: 503 });
    const url = new URL(req.url);
    const result = await createOidcAuthorizationRequest(
      db,
      url.origin,
      url.searchParams.get("returnTo") ?? "/",
    );
    return NextResponse.redirect(result.authorizationUrl);
  } catch {
    let publicOrigin: string;
    try {
      publicOrigin = getOidcPublicOrigin();
    } catch {
      return NextResponse.json({ error: "OIDC authentication is not configured" }, { status: 500 });
    }
    return NextResponse.redirect(new URL("/?authError=oidc_login_failed", publicOrigin));
  }
}
