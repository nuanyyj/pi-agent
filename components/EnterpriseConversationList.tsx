"use client";

import { useEffect, useCallback, useState } from "react";
import { useEnterprise, type EnterpriseConversation } from "@/hooks/useEnterprise";

interface Props {
  selectedConversationId: string | null;
  onDeleteConversation?: (id: string) => void;
  onSelectConversation: (conv: EnterpriseConversation) => void;
  onNewConversation: () => void;
  refreshKey?: number;
}

/**
 * Enterprise conversation list for the sidebar. Replaces SessionSidebar when
 * enterprise mode is active. Shows conversations from PostgreSQL.
 */
export function EnterpriseConversationList({
  selectedConversationId,
  onSelectConversation,
  onNewConversation,
  refreshKey,
  onDeleteConversation,
}: Props) {
  const { isEnabled, conversations, conversationsLoading, loadConversations, organizationId, setOrganizationId } = useEnterprise();
  const [orgInput, setOrgInput] = useState(organizationId);

  useEffect(() => {
    if (isEnabled) loadConversations();
  }, [isEnabled, loadConversations, refreshKey]);

  const handleOrgChange = useCallback(() => {
    const trimmed = orgInput.trim();
    if (trimmed && trimmed !== organizationId) {
      setOrganizationId(trimmed);
    }
  }, [orgInput, organizationId, setOrganizationId]);

  if (!isEnabled) {
    return (
      <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13, textAlign: "center", marginTop: 40 }}>
        Enterprise mode not available.
        <br />
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          Set PI_POSTGRES_URL to enable.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Organization selector */}
      <div style={{
        padding: "8px 10px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap" }}>Org:</span>
        <input
          value={orgInput}
          onChange={(e) => setOrgInput(e.target.value)}
          onBlur={handleOrgChange}
          onKeyDown={(e) => { if (e.key === "Enter") handleOrgChange(); }}
          style={{
            flex: 1, height: 24, fontSize: 11,
            background: "var(--bg)", color: "var(--text)",
            border: "1px solid var(--border)", borderRadius: 3,
            padding: "0 6px",
          }}
        />
      </div>

      {/* New conversation button */}
      <div style={{ padding: "6px 10px" }}>
        <button
          onClick={onNewConversation}
          style={{
            width: "100%", height: 30, fontSize: 12,
            background: "var(--accent)", color: "#fff",
            border: "none", borderRadius: 6, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Conversation
        </button>
      </div>

      {/* Conversation list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 4px" }}>
        {conversationsLoading && conversations.length === 0 && (
          <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
            Loading...
          </div>
        )}

        {!conversationsLoading && conversations.length === 0 && (
          <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
            No conversations yet.
          </div>
        )}

        {conversations.map((conv) => {
          const isSelected = conv.id === selectedConversationId;
          const shortId = conv.id.slice(0, 8);
          const timeStr = formatTime(conv.createdAt);

          return (
            <button
              key={conv.id}
              onClick={() => onSelectConversation(conv)}
              style={{
                display: "flex", flexDirection: "column", gap: 2,
                width: "100%", padding: "8px 10px",
                background: isSelected ? "var(--bg-hover)" : "transparent",
                border: "none", borderRadius: 6,
                cursor: "pointer", textAlign: "left",
                color: "var(--text)",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: isSelected ? 600 : 400, fontFamily: "var(--font-mono)" }}>
                  {shortId}…
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{timeStr}</span>
                  {onDeleteConversation && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); }}
                      title="Delete conversation"
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: 18, height: 18, padding: 0,
                        background: "transparent", border: "none", borderRadius: 3,
                        color: "var(--text-dim)", cursor: "pointer", opacity: 0.5,
                        transition: "opacity 0.12s, color 0.12s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = "#ef4444"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; e.currentTarget.style.color = "var(--text-dim)"; }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
                {conv.organizationId}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  } catch {
    return "";
  }
}
