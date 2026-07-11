"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface AgentRecord {
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

// ── Shared styles (duplicated to avoid circular imports) ──────────────

const thStyle: React.CSSProperties = {
  padding: "6px 10px", textAlign: "left", fontWeight: 600, fontSize: 11,
  color: "var(--text-muted)", whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 10px", color: "var(--text)", whiteSpace: "nowrap",
};

const labelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-muted)",
};

const inputStyle = (disabled = false): React.CSSProperties => ({
  height: 28, fontSize: 12, padding: "0 8px",
  background: disabled ? "var(--bg-hover)" : "var(--bg)",
  color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4,
  opacity: disabled ? 0.6 : 1,
});

const cancelBtnStyle: React.CSSProperties = {
  height: 28, padding: "0 12px", fontSize: 11,
  background: "transparent", color: "var(--text-muted)",
  border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer",
};

const saveBtnStyle = (disabled: boolean): React.CSSProperties => ({
  height: 28, padding: "0 12px", fontSize: 11,
  background: disabled ? "var(--border)" : "var(--accent)",
  color: "#fff", border: "none", borderRadius: 4,
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
});

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

// ── AgentsTab Component ───────────────────────────────────────────────

export function AgentsTab({ organizationId }: { organizationId: string }) {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentRecord | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/enterprise/v1/agents?organizationId=${encodeURIComponent(organizationId)}&includeInactive=true`);
      if (!res.ok) throw new Error("Failed to load agents");
      const data = (await res.json()) as { agents: AgentRecord[] };
      setAgents(data.agents);
    } catch (err) {
      console.error("[admin] load agents failed:", err);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const handleSave = useCallback(async (agent: { id?: string; name: string; description?: string; systemPrompt?: string; defaultModelProvider?: string; defaultModelId?: string; defaultTools?: string[] }) => {
    try {
      const res = await fetch("/api/enterprise/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...agent, organizationId }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to save agent");
      }
      setShowCreate(false);
      setEditingAgent(null);
      loadAgents();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    }
  }, [organizationId, loadAgents]);

  const handleDeactivate = useCallback(async (id: string) => {
    if (!confirm("Deactivate this agent?")) return;
    try {
      const res = await fetch(`/api/enterprise/v1/agents/${encodeURIComponent(id)}?organizationId=${encodeURIComponent(organizationId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to deactivate");
      loadAgents();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Deactivate failed");
    }
  }, [organizationId, loadAgents]);

  return (
    <div style={{ padding: "12px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{agents.length} agents</span>
        <button onClick={() => { setShowCreate(true); setEditingAgent(null); }} style={{ marginLeft: "auto", height: 28, padding: "0 12px", fontSize: 11, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>+ Add Agent</button>
      </div>

      {(showCreate || editingAgent) && (
        <AgentForm agent={editingAgent} onSave={handleSave} onCancel={() => { setShowCreate(false); setEditingAgent(null); }} />
      )}

      {loading && agents.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>Loading...</div>
      ) : agents.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>No agents configured.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Model</th>
              <th style={thStyle}>Tools</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Updated</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={`${a.organizationId}:${a.id}`} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  {a.description && <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{a.description}</div>}
                </td>
                <td style={tdStyle}>{a.defaultModelId}</td>
                <td style={tdStyle}>{a.defaultTools.join(", ")}</td>
                <td style={tdStyle}>
                  <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, background: a.isActive ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: a.isActive ? "#22c55e" : "#ef4444" }}>{a.isActive ? "active" : "inactive"}</span>
                </td>
                <td style={tdStyle}>{formatTime(a.updatedAt)}</td>
                <td style={tdStyle}>
                  <button onClick={() => setEditingAgent(a)} style={{ height: 22, padding: "0 8px", fontSize: 10, background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 3, cursor: "pointer", marginRight: 4 }}>Edit</button>
                  {a.isActive && <button onClick={() => handleDeactivate(a.id)} style={{ height: 22, padding: "0 8px", fontSize: 10, background: "transparent", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 3, cursor: "pointer" }}>Deactivate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Agent Form ────────────────────────────────────────────────────────

function AgentForm({ agent, onSave, onCancel }: {
  agent: AgentRecord | null;
  onSave: (a: { id?: string; name: string; description?: string; systemPrompt?: string; defaultModelProvider?: string; defaultModelId?: string; defaultTools?: string[] }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [modelProvider, setModelProvider] = useState(agent?.defaultModelProvider ?? "openai");
  const [modelId, setModelId] = useState(agent?.defaultModelId ?? "gpt-4o");
  const [tools, setTools] = useState(agent?.defaultTools.join(", ") ?? "read, bash, edit, write");

  return (
    <div style={{ padding: 12, marginBottom: 12, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{agent ? "Edit Agent" : "Create Agent"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <label style={labelStyle}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle()} placeholder="e.g. Code Assistant" />
        </label>
        <label style={labelStyle}>
          Description
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle()} placeholder="Short description" />
        </label>
        <label style={labelStyle}>
          Model Provider
          <select value={modelProvider} onChange={(e) => setModelProvider(e.target.value)} style={{ ...inputStyle(), padding: "0 4px" }}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google</option>
          </select>
        </label>
        <label style={labelStyle}>
          Model ID
          <input value={modelId} onChange={(e) => setModelId(e.target.value)} style={inputStyle()} placeholder="gpt-4o" />
        </label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          Tools (comma-separated)
          <input value={tools} onChange={(e) => setTools(e.target.value)} style={inputStyle()} placeholder="read, bash, edit, write" />
        </label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          System Prompt
          <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={4} style={{ ...inputStyle(), resize: "vertical", minHeight: 80 }} placeholder="System prompt for the agent..." />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
        <button
          onClick={() => onSave({
            id: agent?.id,
            name,
            description: description || undefined,
            systemPrompt: systemPrompt || undefined,
            defaultModelProvider: modelProvider,
            defaultModelId: modelId,
            defaultTools: tools.split(",").map(t => t.trim()).filter(Boolean),
          })}
          disabled={!name.trim()}
          style={saveBtnStyle(!name.trim())}
        >{agent ? "Save" : "Create"}</button>
      </div>
    </div>
  );
}
