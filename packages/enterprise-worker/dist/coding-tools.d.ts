import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { EnterpriseCodingToolName } from "@pi-web/enterprise-protocol";
export declare function createApprovedCodingTools(cwd: string, toolNames: readonly EnterpriseCodingToolName[]): AgentTool[];
