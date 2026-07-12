import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getRunRepository } from "@/lib/enterprise/run-repo";
import { writeAuditEvent } from "@/lib/enterprise/audit-log";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";
import { execFileSync } from "node:child_process";
import { authenticateRequest } from "@/lib/enterprise/auth";
import { requirePermission } from "@/lib/enterprise/rbac";
import { hasOrganizationAccess } from "@/lib/enterprise/request-access";

/**
 * POST /api/enterprise/v1/runs/[id]/cancel
 * Cancel a running enterprise run.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkRateLimit(`run-cancel:${getClientKey(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }
  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const permission = requirePermission(auth.user, "run:cancel");
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

    if (run.status !== "pending" && run.status !== "running") {
      return NextResponse.json(
        { error: `Cannot cancel run in '${run.status}' state` },
        { status: 409 },
      );
    }

    repo.getAbortController(id)?.abort();

    // Kill Docker container if in docker mode
    if (process.env.PI_WORKER_MODE === "docker") {
      try {
        const containers = execFileSync(
          "docker", ["ps", "-q", "--filter", `label=pi-run-id=${id}`],
          { encoding: "utf8", timeout: 5000 }
        ).trim();
        if (containers) {
          for (const cid of containers.split("\n")) {
            if (/^[a-f0-9]+$/i.test(cid)) {
              execFileSync("docker", ["kill", cid], { timeout: 5000 });
            }
          }
        }
      } catch { /* container may already be stopped */ }
    }

    await repo.updateRun(id, {
      status: "cancelled",
      completedAt: new Date().toISOString(),
    });

    // Audit log — fire-and-forget
    const db = await getEnterpriseDb().catch(() => null);
    if (db) {
      writeAuditEvent(db, {
        organizationId: run.organizationId,
        actorId: auth.user.id,
        action: "run.cancelled",
        resourceType: "run",
        resourceId: id,
        details: { conversationId: run.conversationId },
        ipAddress: getClientKey(req),
      }).catch(() => {});
    }

    return NextResponse.json({ id, status: "cancelled" });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
