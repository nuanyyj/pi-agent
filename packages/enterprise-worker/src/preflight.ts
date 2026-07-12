import { parseRunEnvelope, type RunEnvelope } from "@pi-web/enterprise-protocol";

export function preflightRun(input: unknown) {
  const envelope: RunEnvelope = parseRunEnvelope(input);
  return Object.freeze({
    protocolVersion: envelope.protocolVersion,
    runtimeProfile: envelope.runtimeProfile,
    toolNames: Object.freeze([...envelope.toolNames]),
    modelProvider: envelope.modelProvider,
    modelId: envelope.modelId,
    workerKind: "stage-a-worker" as const,
  });
}
