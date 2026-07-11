import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getRunRepository } from "@/lib/enterprise/run-repo";

/**
 * POST /api/enterprise/v1/runs/[id]/cancel
 * Cancel a running enterprise run.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

    // Signal abort if controller exists (in-memory mode)
    repo.getAbortController(id)?.abort();

    await repo.updateRun(id, {
      status: "cancelled",
      completedAt: new Date().toISOString(),
    });

    return NextResponse.json({ id, status: "cancelled" });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
