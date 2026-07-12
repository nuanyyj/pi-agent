import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { createSessionBroker } from "@pi-web/enterprise-session-broker";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";
import { writeAuditEvent } from "@/lib/enterprise/audit-log";
import { authenticateRequest } from "@/lib/enterprise/auth";
import { requirePermission } from "@/lib/enterprise/rbac";
import { resolveOrganizationAccess } from "@/lib/enterprise/request-access";

/**
 * GET /api/enterprise/v1/conversations/[id]
 * Get a single enterprise conversation with its entries.
 * Query params: organizationId (required for org-scoped access check)
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }
  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const permission = requirePermission(auth.user, "conversation:read");
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  try {
    const { id } = await params;
    const url = new URL(req.url);
    const access = resolveOrganizationAccess(auth.user, url.searchParams.get("organizationId"));
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const organizationId = access.organizationId;

    const db = await getEnterpriseDb();
    if (!db) {
      return NextResponse.json({ error: "Enterprise database not available" }, { status: 503 });
    }

    const broker = createSessionBroker(db);
    const snapshot = await broker.openSessionById(id, organizationId);

    return NextResponse.json({
      id: snapshot.metadata.id,
      organizationId: snapshot.metadata.organizationId,
      workspaceRoot: snapshot.metadata.workspaceRoot,
      createdAt: snapshot.metadata.createdAt,
      version: snapshot.version,
      activeLeafId: snapshot.activeLeafId,
      entries: snapshot.entries,
    });
  } catch (error) {
    const msg = sanitizeError(error);
    const status = msg.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * DELETE /api/enterprise/v1/conversations/[id]
 * Soft-delete an enterprise conversation and its associated runs.
 * Query params: organizationId
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkRateLimit(`conv-del:${getClientKey(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const perm = requirePermission(auth.user, "conversation:delete");
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });

  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const url = new URL(req.url);
    const access = resolveOrganizationAccess(auth.user, url.searchParams.get("organizationId"));
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const organizationId = access.organizationId;

    const db = await getEnterpriseDb();
    if (!db) {
      return NextResponse.json({ error: "Enterprise database not available" }, { status: 503 });
    }

    // Soft-delete the session via broker
    const broker = createSessionBroker(db);
    await broker.deleteSession(id, organizationId);

    // Also soft-delete associated runs and their events
    const { getRunRepository } = await import("@/lib/enterprise/run-repo");
    const repo = await getRunRepository();
    const runs = await repo.listRuns({ conversationId: id });
    for (const run of runs) {
      await repo.deleteRun(run.id);
    }

    // Audit log
    writeAuditEvent(db, {
      organizationId,
      actorId: auth.user.id,
      action: "conversation.deleted",
      resourceType: "conversation",
      resourceId: id,
      details: { runsDeleted: runs.length },
      ipAddress: getClientKey(req),
    }).catch(() => {});

    return NextResponse.json({ deleted: true, runsDeleted: runs.length });
  } catch (error) {
    const msg = sanitizeError(error);
    const status = msg.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
