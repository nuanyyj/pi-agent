"use client";

import { useState, useEffect, useCallback } from "react";
import { useEnterprise } from "@/hooks/useEnterprise";

type AdminTab = "users" | "agents" | "quotas";

interface EnterpriseUser {
  id: string;
  organizationId: string;
  email: string | null;
  displayName: string | null;
  roles: string[];
  createdAt: string;
  updatedAt: string;
}

interface QuotaSummary {
  runsToday: number;
  runsThisHour: number;
  runningNow: number;
  tokensInTotal: number;
  tokensOutTotal: number;
  quota: {
    organizationId: string;
    maxRunsPerDay: number;
    maxRunsPerHour: number;
    maxConcurrentRuns: number;
  };
}

/**
 * Enterprise admin panel. Provides user management and quota configuration.
 */
export function EnterpriseAdmin({ organizationId }: { organizationId: string }) {
  const [tab, setTab] = useState<AdminTab>("users");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {/* Header with tabs */}
      <div style={{
        display: "flex", alignItems: "center", gap: 0,
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)", flexShrink: 0,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 16, marginRight: 8 }}>
          <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span style={{ fontSize: 14, fontWeight: 600, marginRight: 16 }}>Admin</span>
        {(["users", "agents", "quotas"] as AdminTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              height: 40, padding: "0 16px", fontSize: 12, fontWeight: tab === t ? 600 : 400,
              background: "transparent", border: "none", borderBottom: `2px solid ${tab === t ? "var(--accent)" : "transparent"}`,
              color: tab === t ? "var(--accent)" : "var(--text-muted)", cursor: "pointer",
              transition: "color 0.12s, border-color 0.12s",
            }}
          >
            {t === "users" ? "Users" : t === "agents" ? "Agents" : "Quotas & Usage"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "users" ? <UsersTab organizationId={organizationId} /> : tab === "agents" ? <AgentsTab organizationId={organizationId} /> : <QuotasTab organizationId={organizationId} />}
      </div>
    </div>
  );
}

// ── Users Tab ────────────────────────────────────────────────────────

function UsersTab({ organizationId }: { organizationId: string }) {
  const [users, setUsers] = useState<EnterpriseUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<EnterpriseUser | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/enterprise/v1/users?organizationId=${encodeURIComponent(organizationId)}`);
      if (!res.ok) throw new Error("Failed to load users");
      const data = (await res.json()) as { users: EnterpriseUser[] };
      setUsers(data.users);
    } catch (err) {
      console.error("[admin] load users failed:", err);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleSave = useCallback(async (user: { id: string; email?: string; displayName?: string; roles: string[] }) => {
    try {
      const res = await fetch("/api/enterprise/v1/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...user, organizationId }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to save user");
      }
      setShowCreate(false);
      setEditingUser(null);
      loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    }
  }, [organizationId, loadUsers]);

  return (
    <div style={{ padding: "12px 16px" }}>
      {/* Action bar */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{users.length} users</span>
        <button
          onClick={() => { setShowCreate(true); setEditingUser(null); }}
          style={{
            marginLeft: "auto", height: 28, padding: "0 12px", fontSize: 11,
            background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4,
            cursor: "pointer",
          }}
        >
          + Add User
        </button>
      </div>

      {/* Create/Edit form */}
      {(showCreate || editingUser) && (
        <UserForm
          user={editingUser}
          onSave={handleSave}
          onCancel={() => { setShowCreate(false); setEditingUser(null); }}
        />
      )}

      {/* Users table */}
      {loading && users.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>Loading...</div>
      ) : users.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>No users configured.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
              <th style={thStyle}>ID</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Display Name</th>
              <th style={thStyle}>Roles</th>
              <th style={thStyle}>Created</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={`${u.organizationId}:${u.id}`} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={tdStyle}>{u.id}</td>
                <td style={tdStyle}>{u.email ?? "—"}</td>
                <td style={tdStyle}>{u.displayName ?? "—"}</td>
                <td style={tdStyle}>
                  {u.roles.map((r) => (
                    <span key={r} style={{
                      display: "inline-block", padding: "1px 6px", borderRadius: 3,
                      fontSize: 10, fontWeight: 600, marginRight: 4,
                      background: roleColor(r).bg, color: roleColor(r).fg,
                    }}>{r}</span>
                  ))}
                </td>
                <td style={tdStyle}>{formatTime(u.createdAt)}</td>
                <td style={tdStyle}>
                  <button
                    onClick={() => setEditingUser(u)}
                    style={{
                      height: 22, padding: "0 8px", fontSize: 10,
                      background: "transparent", color: "var(--text-muted)",
                      border: "1px solid var(--border)", borderRadius: 3, cursor: "pointer",
                    }}
                  >Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── User Form ────────────────────────────────────────────────────────

function UserForm({ user, onSave, onCancel }: {
  user: EnterpriseUser | null;
  onSave: (u: { id: string; email?: string; displayName?: string; roles: string[] }) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(user?.id ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [roles, setRoles] = useState<string[]>(user?.roles ?? ["viewer"]);

  const toggleRole = (role: string) => {
    setRoles((prev) => prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]);
  };

  return (
    <div style={{
      padding: 12, marginBottom: 12,
      background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
        {user ? "Edit User" : "Create User"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <label style={labelStyle}>
          User ID
          <input value={id} onChange={(e) => setId(e.target.value)} disabled={!!user} style={inputStyle(!!user)} placeholder="e.g. user-001" />
        </label>
        <label style={labelStyle}>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle()} placeholder="user@example.com" />
        </label>
        <label style={labelStyle}>
          Display Name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle()} placeholder="John Doe" />
        </label>
        <div style={labelStyle}>
          Roles
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            {["admin", "developer", "viewer"].map((r) => (
              <button
                key={r}
                onClick={() => toggleRole(r)}
                style={{
                  height: 26, padding: "0 10px", fontSize: 11, fontWeight: roles.includes(r) ? 600 : 400,
                  background: roles.includes(r) ? roleColor(r).bg : "transparent",
                  color: roles.includes(r) ? roleColor(r).fg : "var(--text-dim)",
                  border: `1px solid ${roles.includes(r) ? roleColor(r).fg : "var(--border)"}`,
                  borderRadius: 4, cursor: "pointer",
                }}
              >{r}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
        <button
          onClick={() => onSave({ id, email: email || undefined, displayName: displayName || undefined, roles })}
          disabled={!id.trim() || roles.length === 0}
          style={saveBtnStyle(!id.trim() || roles.length === 0)}
        >{user ? "Save" : "Create"}</button>
      </div>
    </div>
  );
}

// ── Quotas Tab ───────────────────────────────────────────────────────

function QuotasTab({ organizationId }: { organizationId: string }) {
  const [summary, setSummary] = useState<QuotaSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ maxRunsPerDay: 100, maxRunsPerHour: 20, maxConcurrentRuns: 5 });

  const loadQuota = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/enterprise/v1/quota?organizationId=${encodeURIComponent(organizationId)}`);
      if (!res.ok) throw new Error("Failed to load quota");
      const data = (await res.json()) as QuotaSummary;
      setSummary(data);
      setForm({
        maxRunsPerDay: data.quota.maxRunsPerDay,
        maxRunsPerHour: data.quota.maxRunsPerHour,
        maxConcurrentRuns: data.quota.maxConcurrentRuns,
      });
    } catch (err) {
      console.error("[admin] load quota failed:", err);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { loadQuota(); }, [loadQuota]);

  const handleSave = useCallback(async () => {
    try {
      const res = await fetch("/api/enterprise/v1/quota", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, ...form }),
      });
      if (!res.ok) throw new Error("Failed to update quota");
      setEditing(false);
      loadQuota();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    }
  }, [organizationId, form, loadQuota]);

  if (loading && !summary) {
    return <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>Loading...</div>;
  }

  if (!summary) {
    return <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>Failed to load quota data.</div>;
  }

  return (
    <div style={{ padding: "12px 16px" }}>
      {/* Usage stats cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
        <StatCard label="Runs Today" value={summary.runsToday} limit={summary.quota.maxRunsPerDay} color="#3b82f6" />
        <StatCard label="Runs This Hour" value={summary.runsThisHour} limit={summary.quota.maxRunsPerHour} color="#8b5cf6" />
        <StatCard label="Running Now" value={summary.runningNow} limit={summary.quota.maxConcurrentRuns} color="#22c55e" />
        <StatCard label="Tokens (30d)" value={summary.tokensInTotal + summary.tokensOutTotal} color="#eab308" />
      </div>

      {/* Quota config */}
      <div style={{
        padding: 12, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Quota Limits</span>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              style={{
                marginLeft: "auto", height: 26, padding: "0 10px", fontSize: 11,
                background: "transparent", color: "var(--text-muted)",
                border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer",
              }}
            >Edit</button>
          )}
        </div>

        {editing ? (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
              <label style={labelStyle}>
                Max Runs / Day
                <input type="number" value={form.maxRunsPerDay} onChange={(e) => setForm((f) => ({ ...f, maxRunsPerDay: Number(e.target.value) }))} style={inputStyle()} />
              </label>
              <label style={labelStyle}>
                Max Runs / Hour
                <input type="number" value={form.maxRunsPerHour} onChange={(e) => setForm((f) => ({ ...f, maxRunsPerHour: Number(e.target.value) }))} style={inputStyle()} />
              </label>
              <label style={labelStyle}>
                Max Concurrent
                <input type="number" value={form.maxConcurrentRuns} onChange={(e) => setForm((f) => ({ ...f, maxConcurrentRuns: Number(e.target.value) }))} style={inputStyle()} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setEditing(false)} style={cancelBtnStyle}>Cancel</button>
              <button onClick={handleSave} style={saveBtnStyle(false)}>Save</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, fontSize: 12 }}>
            <div>
              <div style={{ color: "var(--text-dim)", marginBottom: 2 }}>Max Runs / Day</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{summary.quota.maxRunsPerDay}</div>
            </div>
            <div>
              <div style={{ color: "var(--text-dim)", marginBottom: 2 }}>Max Runs / Hour</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{summary.quota.maxRunsPerHour}</div>
            </div>
            <div>
              <div style={{ color: "var(--text-dim)", marginBottom: 2 }}>Max Concurrent</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{summary.quota.maxConcurrentRuns}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────

function StatCard({ label, value, limit, color }: { label: string; value: number; limit?: number; color: string }) {
  const pct = limit ? Math.min(100, Math.round((value / limit) * 100)) : null;
  return (
    <div style={{
      padding: "10px 12px", background: "var(--bg-panel)",
      border: "1px solid var(--border)", borderRadius: 8,
    }}>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{label}</div>
      {pct !== null && (
        <div style={{ marginTop: 6, height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.3s" }} />
        </div>
      )}
      {limit !== undefined && (
        <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 2 }}>/ {limit}</div>
      )}
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────────────────

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

function roleColor(role: string): { bg: string; fg: string } {
  switch (role) {
    case "admin": return { bg: "rgba(239,68,68,0.1)", fg: "#ef4444" };
    case "developer": return { bg: "rgba(59,130,246,0.1)", fg: "#3b82f6" };
    default: return { bg: "rgba(161,161,170,0.1)", fg: "#a1a1aa" };
  }
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}
import { AgentsTab } from "./AgentsTab";
