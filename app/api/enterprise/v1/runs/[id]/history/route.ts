import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getRunRepository } from "@/lib/enterprise/run-repo";
import { authenticateRequest } from "@/lib/enterprise/auth";
import { requirePermission } from "@/lib/enterprise/rbac";
import { hasOrganizationAccess } from "@/lib/enterprise/request-access";

/**
 * GET /api/enterprise/v1/runs/[id]/history
 * Returns all events for a run as JSON (not SSE). For viewing past runs.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  const auth = await authenticateRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const permission = requirePermission(auth.user, "run:read");
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  try {
    const { id } = await params;
    const repo = await getRunRepository();
    const run = await repo.getRun(id);

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    if (!hasOrganizationAccess(auth.user, run.organizationId)) {
      return NextResponse.json({ error: "Organization access denied" }, { status: 403 });
    }

    // Fetch all events from seq 0
    const events = await repo.getRunEvents(id, 0);

    return NextResponse.json({
      run: {
        id: run.id,
        status: run.status,
        modelProvider: run.modelProvider,
        modelId: run.modelId,
        agentId: run.agentId,
        agentName: run.agentName,
        userInput: run.userInput,
        response: run.response,
        error: run.error,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      },
      events,
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
