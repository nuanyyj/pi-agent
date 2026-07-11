import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { createSessionBroker, PostgresSessionRepo } from "@pi-web/enterprise-session-broker";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";
import { writeAuditEvent } from "@/lib/enterprise/audit-log";
import { randomUUID } from "node:crypto";

/**
 * POST /api/enterprise/v1/conversations
 * Create a new enterprise conversation (session in PostgreSQL).
 */
export async function POST(req: Request) {
  // Rate limit: max 30 conversation creations per minute per client
  if (!checkRateLimit(`conversations:${getClientKey(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  try {
    const body = (await req.json()) as {
      organizationId?: string;
      workspaceRoot?: string;
      conversationId?: string;
    };

    const organizationId = body.organizationId ?? "default";
    const workspaceRoot = body.workspaceRoot ?? process.cwd();
    const conversationId = body.conversationId ?? randomUUID();

    const db = await getEnterpriseDb();
    if (!db) {
      return NextResponse.json({ error: "Enterprise database not available" }, { status: 503 });
    }

    const broker = createSessionBroker(db);
    const repo = new PostgresSessionRepo(broker);

    const session = await repo.create({
      organizationId,
      workspaceRoot,
      id: conversationId,
    });

    const metadata = await session.getMetadata();

    // Audit log
    writeAuditEvent(db, {
      organizationId,
      action: "conversation.created",
      resourceType: "conversation",
      resourceId: conversationId,
      details: { workspaceRoot },
      ipAddress: getClientKey(req),
    }).catch(() => {});

    return NextResponse.json({
      id: metadata.id,
      organizationId: metadata.organizationId,
      workspaceRoot: metadata.workspaceRoot,
      createdAt: metadata.createdAt,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

/**
 * GET /api/enterprise/v1/conversations
 * List enterprise conversations for an organization.
 */
export async function GET(req: Request) {
  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  try {
    const url = new URL(req.url);
    const organizationId = url.searchParams.get("organizationId") ?? "default";

    const db = await getEnterpriseDb();
    if (!db) {
      return NextResponse.json({ error: "Enterprise database not available" }, { status: 503 });
    }

    const broker = createSessionBroker(db);
    const sessions = await broker.listSessions({ organizationId });

    return NextResponse.json({
      conversations: sessions.map((s) => ({
        id: s.id,
        organizationId: s.organizationId,
        workspaceRoot: s.workspaceRoot,
        createdAt: s.createdAt,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
