import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createCodingTools,
  createFindTool,
  createGrepTool,
  createLsTool,
} from "@earendil-works/pi-coding-agent";
import type { EnterpriseCodingToolName } from "@pi-web/enterprise-protocol";

export function createApprovedCodingTools(
  cwd: string,
  toolNames: readonly EnterpriseCodingToolName[],
): AgentTool[] {
  const available = [
    ...createCodingTools(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ];
  const byName = new Map(available.map((tool) => [tool.name, tool]));

  return toolNames.map((name) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`Unsupported Stage A tool: ${name}`);
    return tool;
  });
}
