"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export type EnterpriseConversation = {
  id: string;
  organizationId: string;
  workspaceRoot: string;
  createdAt: string;
};

export type EnterpriseRun = {
  id: string;
  conversationId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  modelProvider: string;
  modelId: string;
  userInput: string;
  response?: string;
  error?: string;
  eventCount: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type EnterpriseRunEvent = {
  seq: number;
  type: string;
  timestamp: string;
  data: unknown;
};

interface EnterpriseContextValue {
  /** Whether enterprise mode is available (PI_POSTGRES_URL configured) */
  isEnabled: boolean;
  /** Current organization ID */
  organizationId: string;
  /** Set organization ID */
  setOrganizationId: (id: string) => void;

  // Conversations
  conversations: EnterpriseConversation[];
  conversationsLoading: boolean;
  loadConversations: () => Promise<void>;
  createConversation: (workspaceRoot?: string) => Promise<EnterpriseConversation>;

  // Runs
  createRun: (input: {
    conversationId: string;
    modelProvider: string;
    modelId: string;
    userInput: string;
    systemPrompt?: string;
    toolNames?: string[];
  }) => Promise<EnterpriseRun>;
  getRun: (id: string) => Promise<EnterpriseRun>;
  cancelRun: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  listRuns: (conversationId?: string) => Promise<EnterpriseRun[]>;
  getRunHistory: (runId: string) => Promise<{ run: EnterpriseRun; events: EnterpriseRunEvent[] }>;

  // SSE event streaming
  subscribeRunEvents: (
    runId: string,
    onEvent: (event: EnterpriseRunEvent) => void,
    onTerminal: (status: string, response?: string, error?: string) => void,
  ) => () => void;
}

const EnterpriseContext = createContext<EnterpriseContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────

export function EnterpriseProvider({ children }: { children: ReactNode }) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [organizationId, setOrganizationId] = useState("default");
  const [conversations, setConversations] = useState<EnterpriseConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);

  // Check enterprise mode on mount
  useEffect(() => {
    fetch("/api/enterprise/v1/conversations")
      .then((res) => {
        setIsEnabled(res.status !== 503);
      })
      .catch(() => {
        setIsEnabled(false);
      });
  }, []);

  // ── Conversations ──────────────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    if (!isEnabled) return;
    setConversationsLoading(true);
    try {
      const res = await fetch(
        `/api/enterprise/v1/conversations?organizationId=${encodeURIComponent(organizationId)}`,
      );
      if (!res.ok) throw new Error("Failed to load conversations");
      const data = (await res.json()) as { conversations: EnterpriseConversation[] };
      setConversations(data.conversations);
    } catch (err) {
      console.error("[enterprise] loadConversations failed:", err);
    } finally {
      setConversationsLoading(false);
    }
  }, [isEnabled, organizationId]);

  const createConversation = useCallback(
    async (workspaceRoot?: string): Promise<EnterpriseConversation> => {
      const res = await fetch("/api/enterprise/v1/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, workspaceRoot }),
      });
      if (!res.ok) throw new Error("Failed to create conversation");
      const conv = (await res.json()) as EnterpriseConversation;
      setConversations((prev) => [conv, ...prev]);
      return conv;
    },
    [organizationId],
  );

  // ── Runs ──────────────────────────────────────────────────────────

  const createRun = useCallback(
    async (input: {
      conversationId: string;
      modelProvider: string;
      modelId: string;
      userInput: string;
      systemPrompt?: string;
      toolNames?: string[];
    }): Promise<EnterpriseRun> => {
      const res = await fetch("/api/enterprise/v1/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, organizationId }),
      });
      if (!res.ok) throw new Error("Failed to create run");
      return (await res.json()) as EnterpriseRun;
    },
    [organizationId],
  );

  const getRun = useCallback(async (id: string): Promise<EnterpriseRun> => {
    const res = await fetch(`/api/enterprise/v1/runs/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error("Failed to get run");
    return (await res.json()) as EnterpriseRun;
  }, []);

  const deleteConversation = useCallback(async (id: string): Promise<void> => {
    const res = await fetch(`/api/enterprise/v1/conversations/${encodeURIComponent(id)}?organizationId=${encodeURIComponent(organizationId)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete conversation");
    setConversations((prev) => prev.filter((c) => c.id !== id));
  }, [organizationId]);

  const cancelRun = useCallback(async (id: string): Promise<void> => {
    const res = await fetch(`/api/enterprise/v1/runs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Failed to cancel run");
  }, []);

  const listRuns = useCallback(
    async (conversationId?: string): Promise<EnterpriseRun[]> => {
      const params = new URLSearchParams();
      if (conversationId) params.set("conversationId", conversationId);
      if (organizationId) params.set("organizationId", organizationId);
      const res = await fetch(`/api/enterprise/v1/runs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to list runs");
      const data = (await res.json()) as { runs: EnterpriseRun[] };
      return data.runs;
    },
    [organizationId],
  );

  const getRunHistory = useCallback(
    async (runId: string): Promise<{ run: EnterpriseRun; events: EnterpriseRunEvent[] }> => {
      const res = await fetch(`/api/enterprise/v1/runs/${encodeURIComponent(runId)}/history`);
      if (!res.ok) throw new Error("Failed to load run history");
      return (await res.json()) as { run: EnterpriseRun; events: EnterpriseRunEvent[] };
    },
    [],
  );

  // ── SSE event streaming ──────────────────────────────────────────

  const subscribeRunEvents = useCallback(
    (
      runId: string,
      onEvent: (event: EnterpriseRunEvent) => void,
      onTerminal: (status: string, response?: string, error?: string) => void,
    ): (() => void) => {
      const es = new EventSource(
        `/api/enterprise/v1/runs/${encodeURIComponent(runId)}/events`,
      );

      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as Record<string, unknown>;

          if (data.type === "terminal") {
            onTerminal(
              data.status as string,
              data.response as string | undefined,
              data.error as string | undefined,
            );
            es.close();
            return;
          }

          if (data.type === "status" || data.type === "error") {
            onEvent({
              seq: (data.seq as number) ?? 0,
              type: data.type as string,
              timestamp: (data.timestamp as string) ?? new Date().toISOString(),
              data,
            });
            return;
          }

          onEvent(data as unknown as EnterpriseRunEvent);
        } catch (err) {
          console.error("[enterprise] SSE parse error:", err);
        }
      };

      es.onerror = () => {
        // EventSource auto-reconnects; close on permanent failure
        if (es.readyState === EventSource.CLOSED) {
          onTerminal("failed", undefined, "SSE connection lost");
        }
      };

      return () => es.close();
    },
    [],
  );

  const value: EnterpriseContextValue = {
    isEnabled,
    organizationId,
    setOrganizationId,
    conversations,
    conversationsLoading,
    loadConversations,
    createConversation,
    createRun,
    getRun,
    cancelRun,
    deleteConversation,
    listRuns,
    subscribeRunEvents,
    getRunHistory,
  };

  return <EnterpriseContext.Provider value={value}>{children}</EnterpriseContext.Provider>;
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useEnterprise(): EnterpriseContextValue {
  const ctx = useContext(EnterpriseContext);
  if (!ctx) throw new Error("useEnterprise must be used within EnterpriseProvider");
  return ctx;
}
