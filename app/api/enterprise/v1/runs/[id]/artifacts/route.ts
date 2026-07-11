import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getRunRepository } from "@/lib/enterprise/run-repo";
import {
  isArtifactStorageEnabled,
  listArtifacts,
  uploadArtifact,
} from "@/lib/enterprise/artifacts";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";

/**
 * GET /api/enterprise/v1/runs/[id]/artifacts
 * List artifacts for a run.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }
  if (!isArtifactStorageEnabled()) {
    return NextResponse.json({ error: "Artifact storage not configured" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const repo = await getRunRepository();
    const run = await repo.getRun(id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const artifacts = await listArtifacts(run.organizationId, id);
    return NextResponse.json({ artifacts });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

/**
 * POST /api/enterprise/v1/runs/[id]/artifacts
 * Upload an artifact for a run. Expects multipart/form-data with a "file" field.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkRateLimit(`artifact:${getClientKey(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }
  if (!isArtifactStorageEnabled()) {
    return NextResponse.json({ error: "Artifact storage not configured" }, { status: 503 });
  }

  try {
    const { id } = await params;
    const repo = await getRunRepository();
    const run = await repo.getRun(id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const artifact = await uploadArtifact({
      organizationId: run.organizationId,
      runId: id,
      filename: file.name,
      data: Buffer.from(arrayBuffer),
      contentType: file.type || undefined,
    });

    return NextResponse.json({ artifact }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
