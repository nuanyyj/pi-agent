import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getRunRepository } from "@/lib/enterprise/run-repo";

/**
 * GET /api/enterprise/v1/runs/[id]
 * Get a single enterprise run with its current status.
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
    const repo = await getRunRepository();
    const run = await repo.getRun(id);

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json(run);
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
