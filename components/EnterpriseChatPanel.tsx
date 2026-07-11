"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useEnterprise, type EnterpriseConversation, type EnterpriseRun, type EnterpriseRunEvent } from "@/hooks/useEnterprise";
import { ChatWindow } from "./ChatWindow";
import type { SessionInfo } from "@/lib/types";

/**
 * Enterprise chat panel that replaces the local ChatWindow when enterprise mode
 * is active. Manages enterprise conversations and runs, renders events via the
 * existing ChatWindow component.
 */
export function EnterpriseChatPanel() {
  const {
    isEnabled,
    organizationId,
    conversations,
    conversationsLoading,
    loadConversations,
    createConversation,
    createRun,
    getRun,
    cancelRun,
    subscribeRunEvents,
  } = useEnterprise();

  const [selectedConversation, setSelectedConversation] = useState<EnterpriseConversation | null>(null);
  const [activeRun, setActiveRun] = useState<EnterpriseRun | null>(null);
  const [runEvents, setRunEvents] = useState<EnterpriseRunEvent[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [modelProvider, setModelProvider] = useState("openai");
  const [modelId, setModelId] = useState("gpt-4o");
  const eventsEndRef = useRef<HTMLDivElement>(null);

  // Load conversations on mount
  useEffect(() => {
    if (isEnabled) loadConversations();
  }, [isEnabled, loadConversations]);

  // Auto-scroll on new events
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [runEvents]);

  const handleCreateConversation = useCallback(async () => {
    try {
      const conv = await createConversation();
      setSelectedConversation(conv);
    } catch (err) {
      console.error("[enterprise] create conversation failed:", err);
    }
  }, [createConversation]);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || !selectedConversation || isRunning) return;

    const userInput = inputValue.trim();
    setInputValue("");
    setIsRunning(true);
    setRunEvents([]);

    try {
      const run = await createRun({
        conversationId: selectedConversation.id,
        modelProvider,
        modelId,
        userInput,
      });

      setActiveRun(run);

      // Subscribe to SSE events
      const unsubscribe = subscribeRunEvents(
        run.id,
        (event) => {
          setRunEvents((prev) => [...prev, event]);
        },
        (status, response, error) => {
          setIsRunning(false);
          setActiveRun((prev) => prev ? { ...prev, status: status as EnterpriseRun["status"], response, error } : null);
        },
      );

      // Store unsubscribe for cleanup
      return () => unsubscribe();
    } catch (err) {
      console.error("[enterprise] create run failed:", err);
      setIsRunning(false);
    }
  }, [inputValue, selectedConversation, isRunning, modelProvider, modelId, createRun, subscribeRunEvents]);

  const handleCancel = useCallback(async () => {
    if (!activeRun) return;
    try {
      await cancelRun(activeRun.id);
      setIsRunning(false);
    } catch (err) {
      console.error("[enterprise] cancel failed:", err);
    }
  }, [activeRun, cancelRun]);

  if (!isEnabled) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {/* Conversation selector */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)", flexShrink: 0,
      }}>
        <select
          value={selectedConversation?.id ?? ""}
          onChange={(e) => {
            const conv = conversations.find((c) => c.id === e.target.value);
            setSelectedConversation(conv ?? null);
          }}
          style={{
            flex: 1, height: 28, fontSize: 12,
            background: "var(--bg)", color: "var(--text)",
            border: "1px solid var(--border)", borderRadius: 4,
            padding: "0 6px",
          }}
        >
          <option value="">Select conversation...</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id.slice(0, 8)}... ({c.organizationId})
            </option>
          ))}
        </select>
        <button
          onClick={handleCreateConversation}
          style={{
            height: 28, padding: "0 10px", fontSize: 11,
            background: "var(--accent)", color: "#fff",
            border: "none", borderRadius: 4, cursor: "pointer",
          }}
        >
          + New
        </button>
      </div>

      {/* Model selector */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 12px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)", flexShrink: 0, fontSize: 11,
      }}>
        <span style={{ color: "var(--text-muted)" }}>Model:</span>
        <select
          value={modelProvider}
          onChange={(e) => setModelProvider(e.target.value)}
          style={{
            height: 24, fontSize: 11,
            background: "var(--bg)", color: "var(--text)",
            border: "1px solid var(--border)", borderRadius: 3,
            padding: "0 4px",
          }}
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Google</option>
        </select>
        <input
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="model-id"
          style={{
            flex: 1, height: 24, fontSize: 11,
            background: "var(--bg)", color: "var(--text)",
            border: "1px solid var(--border)", borderRadius: 3,
            padding: "0 6px",
          }}
        />
      </div>

      {/* Events / messages area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {runEvents.length === 0 && !isRunning && (
          <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", marginTop: 40 }}>
            {selectedConversation
              ? "Send a message to start a run"
              : "Select or create a conversation to begin"}
          </div>
        )}

        {runEvents.map((event) => (
          <div
            key={event.seq}
            style={{
              marginBottom: 8,
              padding: "6px 10px",
              borderRadius: 6,
              fontSize: 12,
              background: event.type === "tool_execution_start"
                ? "rgba(59,130,246,0.08)"
                : event.type === "tool_execution_end"
                  ? "rgba(34,197,94,0.08)"
                  : "var(--bg-panel)",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
              <span style={{ fontWeight: 500, color: "var(--accent)" }}>{event.type}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <pre style={{
              margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all",
              fontSize: 11, color: "var(--text-muted)", maxHeight: 200, overflow: "auto",
            }}>
              {JSON.stringify(event.data, null, 2)}
            </pre>
          </div>
        ))}

        {isRunning && (
          <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "8px 0" }}>
            <span style={{ animation: "pulse 1.5s infinite" }}>⏳ Running...</span>
          </div>
        )}

        {activeRun?.status === "completed" && activeRun.response && (
          <div style={{
            marginTop: 8, padding: "10px 14px",
            background: "rgba(34,197,94,0.06)",
            border: "1px solid rgba(34,197,94,0.2)",
            borderRadius: 8, fontSize: 13,
          }}>
            <div style={{ fontWeight: 500, marginBottom: 4, color: "#22c55e" }}>Response</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{activeRun.response}</div>
          </div>
        )}

        {activeRun?.status === "failed" && (
          <div style={{
            marginTop: 8, padding: "10px 14px",
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 8, fontSize: 13, color: "#f87171",
          }}>
            Run failed: {activeRun.error}
          </div>
        )}

        <div ref={eventsEndRef} />
      </div>

      {/* Input area */}
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 8,
        padding: "10px 12px", borderTop: "1px solid var(--border)",
        background: "var(--bg-panel)", flexShrink: 0,
      }}>
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={selectedConversation ? "Type a message..." : "Select a conversation first"}
          disabled={!selectedConversation}
          rows={1}
          style={{
            flex: 1, resize: "none", fontSize: 13,
            background: "var(--bg)", color: "var(--text)",
            border: "1px solid var(--border)", borderRadius: 6,
            padding: "8px 10px", minHeight: 36, maxHeight: 120,
          }}
        />
        {isRunning ? (
          <button
            onClick={handleCancel}
            style={{
              height: 36, padding: "0 14px", fontSize: 12,
              background: "#ef4444", color: "#fff",
              border: "none", borderRadius: 6, cursor: "pointer",
            }}
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!selectedConversation || !inputValue.trim()}
            style={{
              height: 36, padding: "0 14px", fontSize: 12,
              background: selectedConversation && inputValue.trim() ? "var(--accent)" : "var(--border)",
              color: "#fff", border: "none", borderRadius: 6,
              cursor: selectedConversation && inputValue.trim() ? "pointer" : "default",
            }}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
