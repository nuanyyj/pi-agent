import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { queryAuditEvents, type AuditAction, type AuditResourceType } from "@/lib/enterprise/audit-log";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";
import { authenticateRequest } from "@/lib/enterprise/auth";
import { requirePermission } from "@/lib/enterprise/rbac";
import { resolveOrganizationAccess } from "@/lib/enterprise/request-access";

/**
 * GET /api/enterprise/v1/audit
 * Query enterprise audit events.
 * Query params:
 *   organizationId — filter by org
 *   resourceType   — filter by resource type (conversation | run)
 *   resourceId     — filter by specific resource ID
 *   action         — filter by action name
 *   limit          — max results (default 50, max 200)
 *   offset         — pagination offset
 */
export async function GET(req: Request) {
  if (!checkRateLimit(`audit:${getClientKey(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }
  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const permission = requirePermission(auth.user, "audit:read");
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  try {
    const url = new URL(req.url);
    const access = resolveOrganizationAccess(auth.user, url.searchParams.get("organizationId"));
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const organizationId = access.organizationId;
    const resourceType = url.searchParams.get("resourceType") as AuditResourceType | null;
    const resourceId = url.searchParams.get("resourceId") ?? undefined;
    const action = url.searchParams.get("action") as AuditAction | null;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;

    const db = await getEnterpriseDb();
    if (!db) {
      return NextResponse.json({ error: "Enterprise database not available" }, { status: 503 });
    }

    const result = await queryAuditEvents(db, {
      organizationId,
      resourceType: resourceType ?? undefined,
      resourceId,
      action: action ?? undefined,
      limit,
      offset,
    });

    return NextResponse.json({
      events: result.events,
      total: result.total,
      limit: limit ?? 50,
      offset: offset ?? 0,
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
