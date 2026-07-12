import { describe, expect, it } from "vitest";
import type { EnterpriseDatabase } from "../../packages/enterprise-session-broker/src/db";
import {
  resolveExecutionSnapshot,
} from "../../lib/enterprise/agent-runtime";

function fakeDb(row?: Record<string, unknown>): EnterpriseDatabase {
  return {
    async query<T>() {
      return { rows: row ? [row as T] : [] };
    },
    async transaction<T>(fn: (tx: never) => Promise<T>) {
      return fn(this as never);
    },
    async close() {},
  };
}

describe("resolveExecutionSnapshot", () => {
  it("uses the active agent configuration and ignores request overrides", async () => {
    const snapshot = await resolveExecutionSnapshot(fakeDb({
      id: "agent-1",
      name: "Code Reviewer",
      system_prompt: "Review carefully",
      default_model_provider: "anthropic",
      default_model_id: "claude-sonnet-4-6",
      default_tools: ["read", "grep"],
      is_active: true,
    }), {
      organizationId: "org-1",
      agentId: "agent-1",
      modelProvider: "openai",
      modelId: "ignored-model",
      toolNames: ["bash"],
      systemPrompt: "ignored prompt",
    });

    expect(snapshot).toMatchObject({
      source: "agent",
      agentId: "agent-1",
      agentName: "Code Reviewer",
      modelProvider: "anthropic",
      modelId: "claude-sonnet-4-6",
      toolNames: ["read", "grep"],
      systemPrompt: "Review carefully",
    });
  });

  it("rejects inactive and missing agents", async () => {
    await expect(resolveExecutionSnapshot(fakeDb({
      id: "agent-1",
      name: "Disabled",
      system_prompt: "",
      default_model_provider: "openai",
      default_model_id: "gpt-4o",
      default_tools: [],
      is_active: false,
    }), { organizationId: "org-1", agentId: "agent-1" }))
      .rejects.toMatchObject({ status: 409 });

    await expect(resolveExecutionSnapshot(fakeDb(), {
      organizationId: "org-1",
      agentId: "missing",
    })).rejects.toMatchObject({ status: 404 });
  });

  it("validates custom execution configuration", async () => {
    await expect(resolveExecutionSnapshot(fakeDb(), {
      organizationId: "org-1",
      modelProvider: "openai",
      modelId: "gpt-4o",
      toolNames: ["read", "unknown"],
    })).rejects.toThrow("Unsupported tool: unknown");

    await expect(resolveExecutionSnapshot(fakeDb(), {
      organizationId: "org-1",
      modelProvider: "openai",
      modelId: "gpt-4o",
      toolNames: ["read", "read"],
    })).rejects.toThrow("Duplicate tool: read");
  });
});
