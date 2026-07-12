import { AgentHarness, type AgentHarnessOptions } from "@earendil-works/pi-agent-core";
import type { EnterpriseCodingToolName } from "@pi-web/enterprise-protocol";
export interface CreateStageARuntimeOptions extends Omit<AgentHarnessOptions, "env" | "tools" | "activeToolNames"> {
    cwd: string;
    toolNames: readonly EnterpriseCodingToolName[];
}
export declare function createStageARuntime(options: CreateStageARuntimeOptions): AgentHarness;
