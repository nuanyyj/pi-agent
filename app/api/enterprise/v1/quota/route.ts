import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { authenticateRequest } from "@/lib/enterprise/auth";
import { requirePermission } from "@/lib/enterprise/rbac";
import { updateQuotaConfig, getUsageSummary } from "@/lib/enterprise/quota";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";
import { resolveOrganizationAccess } from "@/lib/enterprise/request-access";

/**
 * GET /api/enterprise/v1/quota
 * Get quota config and usage summary for an organization.
 * Query params: organizationId
 */
export async function GET(req: Request) {
  if (!checkRateLimit(`quota:${getClientKey(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(req.url);
    const access = resolveOrganizationAccess(auth.user, url.searchParams.get("organizationId"));
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const organizationId = access.organizationId;

    const db = await getEnterpriseDb();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const summary = await getUsageSummary(db, organizationId);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

/**
 * PUT /api/enterprise/v1/quota
 * Update quota config for an organization. Requires config:manage permission.
 * Body: { organizationId, maxRunsPerDay?, maxRunsPerHour?, maxConcurrentRuns? }
 */
export async function PUT(req: Request) {
  if (!checkRateLimit(`quota:${getClientKey(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const perm = requirePermission(auth.user, "config:manage");
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });

  try {
    const body = (await req.json()) as {
      organizationId?: string;
      maxRunsPerDay?: number;
      maxRunsPerHour?: number;
      maxConcurrentRuns?: number;
    };

    const access = resolveOrganizationAccess(auth.user, body.organizationId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const organizationId = access.organizationId;

    const db = await getEnterpriseDb();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const config = await updateQuotaConfig(db, {
      ...body,
      organizationId,
    });

    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
