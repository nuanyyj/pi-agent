import { AgentHarness, } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createApprovedCodingTools } from "./coding-tools.js";
export function createStageARuntime(options) {
    const { cwd, toolNames, ...harnessOptions } = options;
    const tools = createApprovedCodingTools(cwd, toolNames);
    return new AgentHarness({
        ...harnessOptions,
        env: new NodeExecutionEnv({ cwd }),
        tools,
        activeToolNames: tools.map((tool) => tool.name),
    });
}
//# sourceMappingURL=stage-a-runtime.js.map