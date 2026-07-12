import { parseRunEnvelope } from "@pi-web/enterprise-protocol";
export function preflightRun(input) {
    const envelope = parseRunEnvelope(input);
    return Object.freeze({
        protocolVersion: envelope.protocolVersion,
        runtimeProfile: envelope.runtimeProfile,
        toolNames: Object.freeze([...envelope.toolNames]),
        modelProvider: envelope.modelProvider,
        modelId: envelope.modelId,
        workerKind: "stage-a-worker",
    });
}
//# sourceMappingURL=preflight.js.map