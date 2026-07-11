import { describe, expect, it } from "vitest";
import { preflightRun } from "../src/preflight";

describe("preflightRun", () => {
  it("returns immutable runtime capabilities", () => {
    expect(preflightRun({
      protocolVersion: 1,
      runtimeProfile: "agent-harness-v1",
      organizationId: "org-1",
      conversationId: "conversation-1",
      runId: "run-1",
      attempt: 1,
      workspaceRoot: "/workspace/run-1",
      toolNames: ["read", "grep"],
      modelProvider: "openai",
      modelId: "gpt-4o",
      userInput: "Hello, world!",
    })).toEqual({
      protocolVersion: 1,
      runtimeProfile: "agent-harness-v1",
      toolNames: ["read", "grep"],
      modelProvider: "openai",
      modelId: "gpt-4o",
      workerKind: "stage-a-worker",
    });
  });
});
