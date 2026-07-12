"use client";

import { useState, useEffect, useCallback } from "react";
import type { EnterpriseRun } from "@/hooks/useEnterprise";

interface Props {
  organizationId: string;
  onSelectRun?: (run: EnterpriseRun) => void;
}

interface RunStats {
  total: number;
  running: number;
  pending: number;
  completed: number;
  failed: number;
  cancelled: number;
}

/**
 * Run status dashboard. Shows an overview of recent runs with status distribution.
 */
export function RunDashboard({ organizationId, onSelectRun }: Props) {
  const [runs, setRuns] = useState<EnterpriseRun[]>([]);
  const [stats, setStats] = useState<RunStats>({ total: 0, running: 0, pending: 0, completed: 0, failed: 0, cancelled: 0 });
  const [loading, setLoading] = useState(false);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ organizationId });
      const res = await fetch(`/api/enterprise/v1/runs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load runs");
      const data = (await res.json()) as { runs: EnterpriseRun[] };
      setRuns(data.runs.slice(0, 20)); // Latest 20

      const s: RunStats = { total: 0, running: 0, pending: 0, completed: 0, failed: 0, cancelled: 0 };
      for (const r of data.runs) {
        s.total++;
        s[r.status]++;
      }
      setStats(s);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    loadRuns();
    const interval = setInterval(loadRuns, 10000);
    return () => clearInterval(interval);
  }, [loadRuns]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)", flexShrink: 0,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 21V9" />
        </svg>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Run Dashboard</span>
        <button
          onClick={loadRuns}
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

      {/* Stats cards */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8,
        padding: "12px 16px", borderBottom: "1px solid var(--border)",
      }}>
        {([
          { label: "Total", value: stats.total, color: "var(--text)" },
          { label: "Running", value: stats.running, color: "#3b82f6" },
          { label: "Pending", value: stats.pending, color: "#eab308" },
          { label: "Completed", value: stats.completed, color: "#22c55e" },
          { label: "Failed", value: stats.failed, color: "#ef4444" },
        ]).map(({ label, value, color }) => (
          <div key={label} style={{
            padding: "10px 12px", background: "var(--bg-panel)",
            border: "1px solid var(--border)", borderRadius: 8,
            textAlign: "center",
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Recent runs table */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", padding: "10px 0 6px" }}>
          Recent Runs
        </div>
        {runs.length === 0 && !loading && (
          <div style={{ padding: 16, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>No runs yet.</div>
        )}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>Model</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id}
                onClick={() => onSelectRun?.(run)}
                style={{
                  borderBottom: "1px solid var(--border)",
                  cursor: onSelectRun ? "pointer" : "default",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <td style={tdStyle}>{run.id.slice(0, 8)}…</td>
                <td style={tdStyle}>{run.modelId}</td>
                <td style={tdStyle}>
                  <span style={{
                    display: "inline-block", padding: "1px 6px", borderRadius: 3,
                    fontSize: 10, fontWeight: 600,
                    background: statusBg(run.status), color: statusColor(run.status),
                  }}>
                    {run.status}
                  </span>
                </td>
                <td style={tdStyle}>{formatTime(run.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "6px 8px", textAlign: "left", fontWeight: 600, fontSize: 10,
  color: "var(--text-dim)", whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px", color: "var(--text)", whiteSpace: "nowrap",
};

function statusColor(s: string): string {
  switch (s) { case "completed": return "#22c55e"; case "running": return "#3b82f6"; case "pending": return "#eab308"; case "failed": return "#ef4444"; default: return "#a1a1aa"; }
}
function statusBg(s: string): string {
  switch (s) { case "completed": return "rgba(34,197,94,0.1)"; case "running": return "rgba(59,130,246,0.1)"; case "pending": return "rgba(234,179,8,0.1)"; case "failed": return "rgba(239,68,68,0.1)"; default: return "var(--bg-hover)"; }
}
function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}
