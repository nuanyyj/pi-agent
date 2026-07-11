import { Type } from "typebox";
import { Compile } from "typebox/compile";
export const EnterpriseCodingToolNameSchema = Type.Union([
    Type.Literal("read"),
    Type.Literal("bash"),
    Type.Literal("edit"),
    Type.Literal("write"),
    Type.Literal("grep"),
    Type.Literal("find"),
    Type.Literal("ls"),
]);
export const RunEnvelopeSchema = Type.Object({
    protocolVersion: Type.Literal(1),
    runtimeProfile: Type.Literal("agent-harness-v1"),
    organizationId: Type.String({ minLength: 1 }),
    conversationId: Type.String({ minLength: 1 }),
    runId: Type.String({ minLength: 1 }),
    attempt: Type.Integer({ minimum: 1 }),
    workspaceRoot: Type.String({ minLength: 1 }),
    toolNames: Type.Array(EnterpriseCodingToolNameSchema),
}, { additionalProperties: false });
const validator = Compile(RunEnvelopeSchema);
export function parseRunEnvelope(input) {
    if (!validator.Check(input)) {
        const first = Array.from(validator.Errors(input))[0];
        throw new Error(`Invalid RunEnvelope: ${first?.instancePath ?? "root"} ${first?.message ?? "failed validation"}`);
    }
    const envelope = input;
    const seen = new Set();
    for (const toolName of envelope.toolNames) {
        if (seen.has(toolName))
            throw new Error(`Duplicate tool: ${toolName}`);
        seen.add(toolName);
    }
    return envelope;
}
//# sourceMappingURL=runtime.js.map