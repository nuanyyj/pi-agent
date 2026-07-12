import {
  AgentHarness,
  type AgentHarnessOptions,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { EnterpriseCodingToolName } from "@pi-web/enterprise-protocol";
import { createApprovedCodingTools } from "./coding-tools.js";

export interface CreateStageARuntimeOptions
  extends Omit<AgentHarnessOptions, "env" | "tools" | "activeToolNames"> {
  cwd: string;
  toolNames: readonly EnterpriseCodingToolName[];
}

export function createStageARuntime(options: CreateStageARuntimeOptions): AgentHarness {
  const { cwd, toolNames, ...harnessOptions } = options;
  const tools: AgentTool[] = createApprovedCodingTools(cwd, toolNames);
  return new AgentHarness({
    ...harnessOptions,
    env: new NodeExecutionEnv({ cwd }),
    tools,
    activeToolNames: tools.map((tool) => tool.name),
  });
}
