import { createCodingTools, createFindTool, createGrepTool, createLsTool, } from "@earendil-works/pi-coding-agent";
export function createApprovedCodingTools(cwd, toolNames) {
    const available = [
        ...createCodingTools(cwd),
        createGrepTool(cwd),
        createFindTool(cwd),
        createLsTool(cwd),
    ];
    const byName = new Map(available.map((tool) => [tool.name, tool]));
    return toolNames.map((name) => {
        const tool = byName.get(name);
        if (!tool)
            throw new Error(`Unsupported Stage A tool: ${name}`);
        return tool;
    });
}
//# sourceMappingURL=coding-tools.js.map