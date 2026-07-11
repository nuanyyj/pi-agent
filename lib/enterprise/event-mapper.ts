/**
 * Maps enterprise run events (from the worker harness) to AgentMessages
 * that can be rendered by the existing MessageView component.
 *
 * The worker emits harness events as CollectedEvent objects. This mapper
 * converts them into the AgentMessage format used by the local chat UI.
 */

import type { AgentMessage, ToolResultMessage } from "@/lib/types";
import type { EnterpriseRunEvent } from "@/hooks/useEnterprise";

interface MappedMessages {
  messages: AgentMessage[];
  toolResults: Map<string, ToolResultMessage>;
}

/**
 * Convert a list of enterprise run events into renderable AgentMessages.
 */
export function mapEventsToMessages(events: EnterpriseRunEvent[]): MappedMessages {
  const messages: AgentMessage[] = [];
  const toolResults = new Map<string, ToolResultMessage>();
  let pendingToolCalls: Map<string, { name: string; input: Record<string, unknown> }> = new Map();

  for (const event of events) {
    const data = event.data as Record<string, unknown>;

    switch (event.type) {
      case "message_end": {
        const msg = data.message as AgentMessage | undefined;
        if (msg) {
          messages.push(normalizeMessage(msg));
        }
        break;
      }

      case "tool_execution_start": {
        const id = data.toolCallId as string;
        const name = data.toolName as string;
        const input = (data.input as Record<string, unknown>) ?? {};
        pendingToolCalls.set(id, { name, input });
        break;
      }

      case "tool_execution_end": {
        const id = data.toolCallId as string;
        const pending = pendingToolCalls.get(id);
        pendingToolCalls.delete(id);

        const result: ToolResultMessage = {
          role: "toolResult",
          toolCallId: id,
          toolName: pending?.name ?? data.toolName as string,
          content: [{ type: "text", text: formatToolResult(data) }],
          isError: Boolean(data.error),
        };
        toolResults.set(id, result);
        break;
      }

      case "agent_start": {
        // Could add a system message indicating run start
        break;
      }

      case "agent_end": {
        // Could add a system message indicating run end
        break;
      }

      // For other event types, we skip — they don't produce visible messages
    }
  }

  return { messages, toolResults };
}

/**
 * Normalize a message from the harness event format.
 * Strips internal fields and ensures content is in the right format.
 */
function normalizeMessage(msg: AgentMessage): AgentMessage {
  if (msg.role === "assistant") {
    return {
      ...msg,
      content: (msg.content ?? []).map((block) => {
        if (block.type === "text" && typeof block.text === "string") {
          return block;
        }
        if (block.type === "toolCall") {
          return block;
        }
        if (block.type === "thinking") {
          return block;
        }
        return block;
      }),
    };
  }
  return msg;
}

/**
 * Format tool execution result for display.
 */
function formatToolResult(data: Record<string, unknown>): string {
  if (data.error) return `Error: ${data.error}`;
  if (data.result !== undefined) {
    const r = data.result;
    if (typeof r === "string") return r;
    try {
      return JSON.stringify(r, null, 2);
    } catch {
      return String(r);
    }
  }
  return "(no result)";
}

/**
 * Create a user AgentMessage from text input.
 */
export function createUserMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
  };
}

/**
 * Create a streaming assistant message placeholder.
 */
export function createStreamingPlaceholder(): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "" }],
    model: "",
    provider: "",
  };
}
