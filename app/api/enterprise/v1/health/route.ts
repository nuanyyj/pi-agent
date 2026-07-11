import { NextResponse } from "next/server";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { isArtifactStorageEnabled } from "@/lib/enterprise/artifacts";

/**
 * GET /api/enterprise/v1/health
 * Health check endpoint for monitoring. Returns service status.
 * No authentication required.
 */
export async function GET() {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  // Check PostgreSQL
  const pgStart = Date.now();
  try {
    const db = await getEnterpriseDb();
    if (db) {
      await db.query("SELECT 1");
      checks.postgres = { status: "ok", latencyMs: Date.now() - pgStart };
    } else {
      checks.postgres = { status: "not_configured" };
    }
  } catch (err) {
    checks.postgres = { status: "error", error: err instanceof Error ? err.message : "unknown" };
  }

  // Check MinIO
  checks.artifacts = {
    status: isArtifactStorageEnabled() ? "configured" : "not_configured",
  };

  // Check enterprise mode
  checks.enterprise = {
    status: isEnterpriseEnabled() ? "enabled" : "disabled",
  };

  // Overall status
  const allOk = Object.values(checks).every((c) => c.status === "ok" || c.status === "configured" || c.status === "enabled" || c.status === "not_configured");

  return NextResponse.json({
    status: allOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
  }, { status: allOk ? 200 : 503 });
}
