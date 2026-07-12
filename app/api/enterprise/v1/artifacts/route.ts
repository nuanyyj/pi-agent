import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import { isArtifactStorageEnabled, downloadArtifact, artifactExists } from "@/lib/enterprise/artifacts";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";
import { authenticateRequest } from "@/lib/enterprise/auth";
import { requirePermission } from "@/lib/enterprise/rbac";
import { resolveOrganizationAccess } from "@/lib/enterprise/request-access";

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
  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const permission = requirePermission(auth.user, "artifact:read");
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

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
    const access = resolveOrganizationAccess(auth.user, parts[0]);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

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
