import { describe, expect, it } from "vitest";
import { parseRunEnvelope } from "../src/runtime";

const validEnvelope = {
  protocolVersion: 1,
  runtimeProfile: "agent-harness-v1",
  organizationId: "org-1",
  conversationId: "conversation-1",
  runId: "run-1",
  attempt: 1,
  workspaceRoot: "/workspace/run-1",
  toolNames: ["read", "grep"],
};

describe("parseRunEnvelope", () => {
  it("accepts the Stage A profile", () => {
    expect(parseRunEnvelope(validEnvelope)).toEqual(validEnvelope);
  });

  it("rejects an unknown runtime profile", () => {
    expect(() =>
      parseRunEnvelope({ ...validEnvelope, runtimeProfile: "coding-agent-rpc" }),
    ).toThrow("Invalid RunEnvelope");
  });

  it("rejects duplicate tools", () => {
    expect(() =>
      parseRunEnvelope({ ...validEnvelope, toolNames: ["read", "read"] }),
    ).toThrow("Duplicate tool: read");
  });
});
