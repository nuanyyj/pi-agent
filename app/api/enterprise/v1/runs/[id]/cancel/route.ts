import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getRunRepository } from "@/lib/enterprise/run-repo";
import { writeAuditEvent } from "@/lib/enterprise/audit-log";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";
import { execSync } from "node:child_process";

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

  try {
    const { id } = await params;
    const repo = await getRunRepository();
    const run = await repo.getRun(id);

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
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
        const containers = execSync(
          "docker ps -q --filter label=pi-run-id=" + id,
          { encoding: "utf8", timeout: 5000 }
        ).trim();
        if (containers) {
          for (const cid of containers.split("\n")) {
            execSync("docker kill " + cid, { timeout: 5000 });
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
