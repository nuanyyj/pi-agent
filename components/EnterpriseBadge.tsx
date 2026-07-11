"use client";

import { useEnterprise } from "@/hooks/useEnterprise";

/**
 * Small badge shown in the top bar when enterprise mode is active.
 * Displays the current organization and a green/gray indicator.
 */
export function EnterpriseBadge() {
  const { isEnabled, organizationId } = useEnterprise();

  if (!isEnabled) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 8px",
        height: "100%",
        borderRight: "1px solid var(--border)",
        fontSize: 11,
        color: "var(--text-muted)",
        userSelect: "none",
      }}
      title={`Enterprise mode — Organization: ${organizationId}`}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#22c55e",
          flexShrink: 0,
        }}
      />
      <span style={{ fontWeight: 500 }}>Enterprise</span>
    </div>
  );
}
