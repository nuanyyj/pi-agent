import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { createSessionBroker } from "@pi-web/enterprise-session-broker";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";

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

  try {
    const { id } = await params;
    const url = new URL(req.url);
    const organizationId = url.searchParams.get("organizationId") ?? "default";

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

  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const url = new URL(req.url);
    const organizationId = url.searchParams.get("organizationId") ?? "default";

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

    return NextResponse.json({ deleted: true, runsDeleted: runs.length });
  } catch (error) {
    const msg = sanitizeError(error);
    const status = msg.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
