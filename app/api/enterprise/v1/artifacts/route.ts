import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import { isArtifactStorageEnabled, downloadArtifact, artifactExists } from "@/lib/enterprise/artifacts";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";

/**
 * GET /api/enterprise/v1/artifacts?key=<url-encoded-key>
 * Download an artifact by its storage key.
 * The key format is: {organizationId}/{runId}/{filename}
 */
export async function GET(req: Request) {
  if (!checkRateLimit(`artifact-dl:${getClientKey(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }
  if (!isArtifactStorageEnabled()) {
    return NextResponse.json({ error: "Artifact storage not configured" }, { status: 503 });
  }

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "key parameter required" }, { status: 400 });
    }

    // Basic key validation — must have at least 3 path segments
    const parts = key.split("/");
    if (parts.length < 3 || key.includes("..")) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }

    const exists = await artifactExists(key);
    if (!exists) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const { data, contentType } = await downloadArtifact(key);
    const filename = parts[parts.length - 1];

    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(data.length),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
