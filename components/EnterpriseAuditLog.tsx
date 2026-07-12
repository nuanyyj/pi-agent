"use client";

import { useState, useEffect, useCallback } from "react";
import type { AuditEvent } from "@/lib/enterprise/audit-log";

/**
 * Enterprise audit log viewer. Displays audit events with filtering.
 */
export function EnterpriseAuditLog({ organizationId }: { organizationId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [filterAction, setFilterAction] = useState("");
  const [filterResourceType, setFilterResourceType] = useState("");
  const limit = 25;

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ organizationId, limit: String(limit), offset: String(offset) });
      if (filterAction) params.set("action", filterAction);
      if (filterResourceType) params.set("resourceType", filterResourceType);

      const res = await fetch(`/api/enterprise/v1/audit?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load audit events");
      const data = (await res.json()) as { events: AuditEvent[]; total: number };
      setEvents(data.events);
      setTotal(data.total);
    } catch (err) {
      console.error("[audit] load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [organizationId, offset, filterAction, filterResourceType]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleFilterChange = useCallback(() => {
    setOffset(0);
  }, []);

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)", flexShrink: 0,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Audit Log</span>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{total} events</span>
      </div>

      {/* Filters */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 16px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)", flexShrink: 0, fontSize: 12,
      }}>
        <span style={{ color: "var(--text-muted)" }}>Action:</span>
        <select
          value={filterAction}
          onChange={(e) => { setFilterAction(e.target.value); handleFilterChange(); }}
          style={{
            height: 26, fontSize: 11, background: "var(--bg)", color: "var(--text)",
            border: "1px solid var(--border)", borderRadius: 4, padding: "0 6px",
          }}
        >
          <option value="">All</option>
          <option value="run.created">run.created</option>
          <option value="run.cancelled">run.cancelled</option>
          <option value="run.completed">run.completed</option>
          <option value="run.failed">run.failed</option>
          <option value="conversation.created">conversation.created</option>
          <option value="conversation.deleted">conversation.deleted</option>
        </select>

        <span style={{ color: "var(--text-muted)" }}>Type:</span>
        <select
          value={filterResourceType}
          onChange={(e) => { setFilterResourceType(e.target.value); handleFilterChange(); }}
          style={{
            height: 26, fontSize: 11, background: "var(--bg)", color: "var(--text)",
            border: "1px solid var(--border)", borderRadius: 4, padding: "0 6px",
          }}
        >
          <option value="">All</option>
          <option value="run">Run</option>
          <option value="conversation">Conversation</option>
        </select>

        <button
          onClick={loadEvents}
          disabled={loading}
          style={{
            marginLeft: "auto", height: 26, padding: "0 10px", fontSize: 11,
            background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4,
            cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1,
          }}
        >
          Refresh
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && events.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>Loading...</div>
        )}

        {!loading && events.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>No audit events found.</div>
        )}

        {events.length > 0 && (
          <table style={{
            width: "100%", borderCollapse: "collapse", fontSize: 12,
            fontFamily: "var(--font-mono)",
          }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Action</th>
                <th style={thStyle}>Resource</th>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Actor</th>
                <th style={thStyle}>IP</th>
                <th style={thStyle}>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={tdStyle} title={ev.recordedAt}>
                    {formatTime(ev.recordedAt)}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      display: "inline-block", padding: "1px 6px", borderRadius: 3,
                      fontSize: 10, fontWeight: 600,
                      background: actionColor(ev.action).bg,
                      color: actionColor(ev.action).fg,
                    }}>
                      {ev.action}
                    </span>
                  </td>
                  <td style={tdStyle}>{ev.resourceType}</td>
                  <td style={tdStyle} title={ev.resourceId}>
                    {ev.resourceId.slice(0, 8)}…
                  </td>
                  <td style={tdStyle}>{ev.actorId}</td>
                  <td style={tdStyle}>{ev.ipAddress ?? "—"}</td>
                  <td style={{ ...tdStyle, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={JSON.stringify(ev.details, null, 2)}>
                    {formatDetails(ev.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          padding: "8px 16px", borderTop: "1px solid var(--border)",
          background: "var(--bg-panel)", flexShrink: 0, fontSize: 12,
        }}>
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={currentPage <= 1}
            style={paginationBtnStyle(currentPage <= 1)}
          >
            ← Prev
          </button>
          <span style={{ color: "var(--text-muted)" }}>
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={currentPage >= totalPages}
            style={paginationBtnStyle(currentPage >= totalPages)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "6px 10px", textAlign: "left", fontWeight: 600, fontSize: 11,
  color: "var(--text-muted)", whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 10px", color: "var(--text)", whiteSpace: "nowrap",
};

function paginationBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    height: 26, padding: "0 10px", fontSize: 11,
    background: "var(--bg)", color: disabled ? "var(--text-dim)" : "var(--text)",
    border: "1px solid var(--border)", borderRadius: 4,
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
  };
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function formatDetails(details: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return "—";
  return Object.entries(details)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v.slice(0, 30) : JSON.stringify(v)}`)
    .join(", ");
}

function actionColor(action: string): { bg: string; fg: string } {
  if (action.includes("created")) return { bg: "rgba(34,197,94,0.12)", fg: "#22c55e" };
  if (action.includes("deleted")) return { bg: "rgba(239,68,68,0.12)", fg: "#ef4444" };
  if (action.includes("cancelled")) return { bg: "rgba(234,179,8,0.12)", fg: "#eab308" };
  if (action.includes("failed")) return { bg: "rgba(239,68,68,0.12)", fg: "#ef4444" };
  if (action.includes("completed")) return { bg: "rgba(59,130,246,0.12)", fg: "#3b82f6" };
  return { bg: "var(--bg-hover)", fg: "var(--text-muted)" };
}
