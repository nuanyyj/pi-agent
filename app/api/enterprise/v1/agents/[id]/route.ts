import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { authenticateRequest } from "@/lib/enterprise/auth";
import { requirePermission } from "@/lib/enterprise/rbac";
import { resolveOrganizationAccess } from "@/lib/enterprise/request-access";
import { writeAuditEvent } from "@/lib/enterprise/audit-log";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id } = await params;
    const url = new URL(req.url);
    const access = resolveOrganizationAccess(auth.user, url.searchParams.get("organizationId"));
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const organizationId = access.organizationId;

    const db = await getEnterpriseDb();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const result = await db.query(
      `SELECT id, organization_id, name, description, system_prompt,
              default_model_provider, default_model_id, default_tools,
              is_active, created_at, updated_at
       FROM enterprise_agents WHERE id = $1 AND organization_id = $2`,
      [id, organizationId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const row = result.rows[0] as Record<string, unknown>;
    const canManage = requirePermission(auth.user, "config:manage").ok;
    return NextResponse.json({
      id: row.id, organizationId: row.organization_id, name: row.name,
      description: row.description, systemPrompt: canManage ? row.system_prompt : "",
      defaultModelProvider: row.default_model_provider, defaultModelId: row.default_model_id,
      defaultTools: row.default_tools, isActive: row.is_active,
      createdAt: row.created_at, updatedAt: row.updated_at,
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkRateLimit(`agent-delete:${getClientKey(req)}`, 10, 60_000)) {
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
    const { id } = await params;
    const url = new URL(req.url);
    const access = resolveOrganizationAccess(auth.user, url.searchParams.get("organizationId"));
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const organizationId = access.organizationId;

    const db = await getEnterpriseDb();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const result = await db.query(
      `UPDATE enterprise_agents SET is_active = false, updated_at = now()
       WHERE id = $1 AND organization_id = $2 AND is_active = true RETURNING id`,
      [id, organizationId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Agent not found or already inactive" }, { status: 404 });
    }

    writeAuditEvent(db, {
      organizationId, action: "agent.deactivated", resourceType: "agent",
      resourceId: id, ipAddress: getClientKey(req),
    }).catch(() => {});

    return NextResponse.json({ id, status: "deactivated" });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
