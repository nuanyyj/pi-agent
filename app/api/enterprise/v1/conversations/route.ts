import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { createSessionBroker, PostgresSessionRepo } from "@pi-web/enterprise-session-broker";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";
import { writeAuditEvent } from "@/lib/enterprise/audit-log";
import { authenticateRequest } from "@/lib/enterprise/auth";
import { requirePermission } from "@/lib/enterprise/rbac";
import { resolveOrganizationAccess } from "@/lib/enterprise/request-access";
import {
  resolveEnterpriseWorkspaceRoot,
  WorkspacePolicyError,
} from "@/lib/enterprise/workspace-policy";
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

  // Authentication + RBAC
  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const perm = requirePermission(auth.user, "conversation:create");
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });

  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  try {
    const body = (await req.json()) as {
      organizationId?: string;
      workspaceRoot?: string;
      conversationId?: string;
    };

    const access = resolveOrganizationAccess(auth.user, body.organizationId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const organizationId = access.organizationId;
    const workspaceRoot = await resolveEnterpriseWorkspaceRoot(body.workspaceRoot);
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
      actorId: auth.user.id,
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
    if (error instanceof WorkspacePolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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
  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const permission = requirePermission(auth.user, "conversation:read");
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  try {
    const url = new URL(req.url);
    const access = resolveOrganizationAccess(auth.user, url.searchParams.get("organizationId"));
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const organizationId = access.organizationId;

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
