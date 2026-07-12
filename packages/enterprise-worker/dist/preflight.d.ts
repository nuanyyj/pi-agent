export declare function preflightRun(input: unknown): Readonly<{
    protocolVersion: 1;
    runtimeProfile: "agent-harness-v1";
    toolNames: readonly ("read" | "bash" | "edit" | "write" | "grep" | "find" | "ls")[];
    modelProvider: string;
    modelId: string;
    workerKind: "stage-a-worker";
}>;
