import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getRun } from "@/lib/enterprise/run-store";

/**
 * GET /api/enterprise/v1/runs/[id]
 * Get a single enterprise run with its current status and events.
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
    const run = getRun(id);

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: run.id,
      conversationId: run.conversationId,
      organizationId: run.organizationId,
      status: run.status,
      modelProvider: run.modelProvider,
      modelId: run.modelId,
      userInput: run.userInput,
      response: run.response,
      error: run.error,
      eventCount: run.events.length,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
