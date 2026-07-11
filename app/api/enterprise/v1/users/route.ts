import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { authenticateRequest } from "@/lib/enterprise/auth";
import { requirePermission } from "@/lib/enterprise/rbac";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";

/**
 * GET /api/enterprise/v1/users
 * List users in an organization. Requires user:manage permission.
 */
export async function GET(req: Request) {
  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const perm = requirePermission(auth.user, "user:manage");
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });

  try {
    const url = new URL(req.url);
    const organizationId = url.searchParams.get("organizationId") ?? "default";

    const db = await getEnterpriseDb();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const result = await db.query(
      `SELECT id, organization_id, email, display_name, roles, created_at, updated_at
       FROM enterprise_users WHERE organization_id = $1 ORDER BY created_at DESC`,
      [organizationId],
    );

    return NextResponse.json({
      users: result.rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        organizationId: row.organization_id,
        email: row.email,
        displayName: row.display_name,
        roles: row.roles,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

/**
 * POST /api/enterprise/v1/users
 * Create or update a user. Requires user:manage permission.
 * Body: { id, organizationId?, email?, displayName?, roles }
 */
export async function POST(req: Request) {
  if (!checkRateLimit(`users:${getClientKey(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const perm = requirePermission(auth.user, "user:manage");
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });

  try {
    const body = (await req.json()) as {
      id: string;
      organizationId?: string;
      email?: string;
      displayName?: string;
      roles?: string[];
    };

    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const organizationId = body.organizationId ?? "default";
    const roles = body.roles ?? ["viewer"];

    // Validate roles
    const validRoles = ["admin", "developer", "viewer"];
    for (const role of roles) {
      if (!validRoles.includes(role)) {
        return NextResponse.json({ error: `Invalid role: ${role}. Must be one of: ${validRoles.join(", ")}` }, { status: 400 });
      }
    }

    const db = await getEnterpriseDb();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    await db.query(
      `INSERT INTO enterprise_users (id, organization_id, email, display_name, roles, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (id, organization_id) DO UPDATE SET
         email = COALESCE(EXCLUDED.email, enterprise_users.email),
         display_name = COALESCE(EXCLUDED.display_name, enterprise_users.display_name),
         roles = EXCLUDED.roles,
         updated_at = now()`,
      [body.id, organizationId, body.email ?? null, body.displayName ?? null, roles],
    );

    return NextResponse.json({ id: body.id, organizationId, roles }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
