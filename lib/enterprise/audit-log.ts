/**
 * Enterprise audit log — append-only event recording.
 *
 * Events are written to PostgreSQL `enterprise_audit_events` table.
 * This module provides a writer (for API routes) and a reader (for the audit API).
 */

import { getEnterpriseDb } from "./db";
import type { EnterpriseDatabase } from "@pi-web/enterprise-session-broker";

// ── Types ──────────────────────────────────────────────────────────────

export type AuditAction =
  | "conversation.created"
  | "conversation.deleted"
  | "run.created"
  | "run.cancelled"
  | "run.completed"
  | "run.failed"
  | "agent.created"
  | "agent.updated"
  | "agent.deactivated";

export type AuditResourceType = "conversation" | "run" | "agent";

export interface AuditEvent {
  id: number;
  organizationId: string;
  actorId: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  details: Record<string, unknown>;
  ipAddress: string | null;
  recordedAt: string;
}

export interface WriteAuditEventInput {
  organizationId: string;
  actorId?: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}

export interface QueryAuditEventsOptions {
  organizationId?: string;
  resourceType?: AuditResourceType;
  resourceId?: string;
  action?: AuditAction;
  limit?: number;
  offset?: number;
}

// ── Writer ─────────────────────────────────────────────────────────────

/**
 * Write a single audit event. Fire-and-forget safe — errors are logged, not thrown.
 */
export async function writeAuditEvent(
  db: EnterpriseDatabase,
  input: WriteAuditEventInput,
): Promise<void> {
  try {
    await db.query(
      `insert into enterprise_audit_events
         (organization_id, actor_id, action, resource_type, resource_id, details, ip_address)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.organizationId,
        input.actorId ?? "system",
        input.action,
        input.resourceType,
        input.resourceId,
        JSON.stringify(input.details ?? {}),
        input.ipAddress ?? null,
      ],
    );
  } catch (err) {
    // Audit failures should never block the primary operation
    console.error("[audit-log] write failed:", err);
  }
}

// ── Reader ─────────────────────────────────────────────────────────────

/**
 * Query audit events with optional filters.
 */
export async function queryAuditEvents(
  db: EnterpriseDatabase,
  options: QueryAuditEventsOptions,
): Promise<{ events: AuditEvent[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (options.organizationId) {
    conditions.push(`organization_id = $${idx++}`);
    params.push(options.organizationId);
  }
  if (options.resourceType) {
    conditions.push(`resource_type = $${idx++}`);
    params.push(options.resourceType);
  }
  if (options.resourceId) {
    conditions.push(`resource_id = $${idx++}`);
    params.push(options.resourceId);
  }
  if (options.action) {
    conditions.push(`action = $${idx++}`);
    params.push(options.action);
  }

  const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;

  // Count
  const countResult = await db.query<{ count: string }>(
    `select count(*) as count from enterprise_audit_events ${where}`,
    params,
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  // Fetch
  const rows = await db.query<{
    id: string;
    organization_id: string;
    actor_id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    details: unknown;
    ip_address: string | null;
    recorded_at: string;
  }>(
    `select id, organization_id, actor_id, action, resource_type, resource_id, details, ip_address, recorded_at
     from enterprise_audit_events ${where}
     order by recorded_at desc
     limit $${idx++} offset $${idx++}`,
    [...params, limit, offset],
  );

  const events: AuditEvent[] = rows.rows.map((row: { id: string; organization_id: string; actor_id: string; action: string; resource_type: string; resource_id: string; details: unknown; ip_address: string | null; recorded_at: string }) => ({
    id: Number(row.id),
    organizationId: row.organization_id,
    actorId: row.actor_id,
    action: row.action as AuditAction,
    resourceType: row.resource_type as AuditResourceType,
    resourceId: row.resource_id,
    details: (typeof row.details === "string" ? JSON.parse(row.details) : row.details) as Record<string, unknown>,
    ipAddress: row.ip_address,
    recordedAt: row.recorded_at,
  }));

  return { events, total };
}
