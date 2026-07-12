"use client";

import { useState, useEffect, useCallback } from "react";
import type { EnterpriseRun } from "@/hooks/useEnterprise";

interface Props {
  conversationId: string;
  activeRunId: string | null;
  onSelectRun: (run: EnterpriseRun) => void;
  /** Called to load events for a past run */
  onLoadRunEvents: (runId: string) => void;
}

/**
 * Shows run history for a conversation. Collapsible panel in the chat header.
 */
export function RunHistory({ conversationId, activeRunId, onSelectRun, onLoadRunEvents }: Props) {
  const [runs, setRuns] = useState<EnterpriseRun[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ conversationId });
      const res = await fetch(`/api/enterprise/v1/runs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load runs");
      const data = (await res.json()) as { runs: EnterpriseRun[] };
      setRuns(data.runs);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (expanded) loadRuns();
  }, [expanded, loadRuns]);

  // Refresh when active run changes (new run completed, etc.)
  useEffect(() => {
    if (expanded) loadRuns();
  }, [activeRunId, expanded, loadRuns]);

  if (runs.length === 0 && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "2px 8px", fontSize: 10, color: "var(--text-dim)",
          background: "transparent", border: "none", cursor: "pointer",
        }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
        History
      </button>
    );
  }

  return (
    <div style={{ borderBottom: expanded ? "1px solid var(--border)" : "none" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", gap: 4, width: "100%",
          padding: "4px 12px", fontSize: 10, color: "var(--text-dim)",
          background: "transparent", border: "none", cursor: "pointer",
          textAlign: "left",
        }}
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        Run History ({runs.length})
        {loading && <span style={{ marginLeft: 4, opacity: 0.5 }}>...</span>}
      </button>

      {expanded && (
        <div style={{ maxHeight: 200, overflowY: "auto", padding: "0 12px 8px" }}>
          {runs.length === 0 && !loading && (
            <div style={{ fontSize: 11, color: "var(--text-dim)", padding: "4px 0" }}>No runs yet.</div>
          )}
          {runs.map((run) => {
            const isActive = run.id === activeRunId;
            return (
              <button
                key={run.id}
                onClick={() => {
                  onSelectRun(run);
                  onLoadRunEvents(run.id);
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "5px 6px", fontSize: 11,
                  background: isActive ? "var(--bg-hover)" : "transparent",
                  border: "none", borderRadius: 4, cursor: "pointer",
                  textAlign: "left", color: "var(--text)",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = isActive ? "var(--bg-hover)" : "transparent"; }}
              >
                {/* Status dot */}
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: statusColor(run.status),
                }} />
                {/* Run info */}
                <span style={{ flex: 1, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {run.id.slice(0, 8)}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                  {run.modelId}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                  {formatTime(run.createdAt)}
                </span>
                {/* Status badge */}
                <span style={{
                  fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 3,
                  background: statusBg(run.status), color: statusColor(run.status),
                }}>
                  {run.status}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return "#22c55e";
    case "running": return "#3b82f6";
    case "pending": return "#eab308";
    case "failed": return "#ef4444";
    case "cancelled": return "#a1a1aa";
    default: return "var(--text-dim)";
  }
}

function statusBg(status: string): string {
  switch (status) {
    case "completed": return "rgba(34,197,94,0.1)";
    case "running": return "rgba(59,130,246,0.1)";
    case "pending": return "rgba(234,179,8,0.1)";
    case "failed": return "rgba(239,68,68,0.1)";
    case "cancelled": return "rgba(161,161,170,0.1)";
    default: return "var(--bg-hover)";
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
