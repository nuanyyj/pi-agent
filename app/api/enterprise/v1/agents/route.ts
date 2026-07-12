import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { authenticateRequest } from "@/lib/enterprise/auth";
import { hasPermission, requirePermission } from "@/lib/enterprise/rbac";
import { resolveOrganizationAccess } from "@/lib/enterprise/request-access";
import { writeAuditEvent } from "@/lib/enterprise/audit-log";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";
import { randomUUID } from "node:crypto";

interface AgentRecord {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  systemPrompt: string;
  defaultModelProvider: string;
  defaultModelId: string;
  defaultTools: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/enterprise/v1/agents
 * List agents in an organization.
 */
export async function GET(req: Request) {
  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(req.url);
    const access = resolveOrganizationAccess(auth.user, url.searchParams.get("organizationId"));
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const organizationId = access.organizationId;
    const includeInactive = url.searchParams.get("includeInactive") === "true";
    const canManage = hasPermission(auth.user, "config:manage");
    if (includeInactive && !canManage) {
      return NextResponse.json({ error: "Permission denied: config:manage required" }, { status: 403 });
    }

    const db = await getEnterpriseDb();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    const where = includeInactive
      ? "WHERE organization_id = $1"
      : "WHERE organization_id = $1 AND is_active = true";

    const result = await db.query(
      `SELECT id, organization_id, name, description, system_prompt,
              default_model_provider, default_model_id, default_tools,
              is_active, created_at, updated_at
       FROM enterprise_agents ${where} ORDER BY name ASC`,
      [organizationId],
    );

    return NextResponse.json({
      agents: result.rows.map((row) => toAgentRecord(row, canManage)),
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

/**
 * POST /api/enterprise/v1/agents
 * Create or update an agent. Requires config:manage permission.
 * Body: { id?, organizationId?, name, description?, systemPrompt?, defaultModelProvider?, defaultModelId?, defaultTools? }
 */
export async function POST(req: Request) {
  if (!checkRateLimit(`agents:${getClientKey(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const perm = requirePermission(auth.user, "config:manage");
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });

  try {
    const body = (await req.json()) as {
      id?: string;
      organizationId?: string;
      name: string;
      description?: string;
      systemPrompt?: string;
      defaultModelProvider?: string;
      defaultModelId?: string;
      defaultTools?: string[];
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const access = resolveOrganizationAccess(auth.user, body.organizationId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const organizationId = access.organizationId;
    const agentId = body.id?.trim() || randomUUID();

    const db = await getEnterpriseDb();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 503 });

    await db.query(
      `INSERT INTO enterprise_agents
         (id, organization_id, name, description, system_prompt,
          default_model_provider, default_model_id, default_tools, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (id, organization_id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         system_prompt = EXCLUDED.system_prompt,
         default_model_provider = EXCLUDED.default_model_provider,
         default_model_id = EXCLUDED.default_model_id,
         default_tools = EXCLUDED.default_tools,
         updated_at = now()`,
      [
        agentId,
        organizationId,
        body.name.trim(),
        body.description ?? "",
        body.systemPrompt ?? "",
        body.defaultModelProvider ?? "openai",
        body.defaultModelId ?? "gpt-4o",
        JSON.stringify(body.defaultTools ?? ["read", "bash", "edit", "write"]),
      ],
    );

    // Audit
    const auditDb = await getEnterpriseDb().catch(() => null);
    if (auditDb) {
      writeAuditEvent(auditDb, {
        organizationId,
        action: body.id ? "agent.updated" : "agent.created",
        resourceType: "agent",
        resourceId: agentId,
        details: { name: body.name },
        ipAddress: getClientKey(req),
      }).catch(() => {});
    }

    return NextResponse.json({ id: agentId, organizationId }, { status: body.id ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function toAgentRecord(row: Record<string, unknown>, includeSensitive: boolean): AgentRecord {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    systemPrompt: includeSensitive ? (row.system_prompt as string) ?? "" : "",
    defaultModelProvider: (row.default_model_provider as string) ?? "openai",
    defaultModelId: (row.default_model_id as string) ?? "gpt-4o",
    defaultTools: Array.isArray(row.default_tools) ? (row.default_tools as string[]) : [],
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
