import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { createSessionBroker } from "@pi-web/enterprise-session-broker";

/**
 * GET /api/enterprise/v1/conversations/[id]
 * Get a single enterprise conversation with its entries.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const db = await getEnterpriseDb();
    if (!db) {
      return NextResponse.json({ error: "Enterprise database not available" }, { status: 503 });
    }

    const broker = createSessionBroker(db);
    const snapshot = await broker.openSessionById(id, "");

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
