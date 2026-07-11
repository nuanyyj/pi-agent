import { type Static, Type } from "typebox";
export declare const EnterpriseCodingToolNameSchema: Type.TUnion<[Type.TLiteral<"read">, Type.TLiteral<"bash">, Type.TLiteral<"edit">, Type.TLiteral<"write">, Type.TLiteral<"grep">, Type.TLiteral<"find">, Type.TLiteral<"ls">]>;
export type EnterpriseCodingToolName = Static<typeof EnterpriseCodingToolNameSchema>;
export declare const RunEnvelopeSchema: Type.TObject<{
    protocolVersion: Type.TLiteral<1>;
    runtimeProfile: Type.TLiteral<"agent-harness-v1">;
    organizationId: Type.TString;
    conversationId: Type.TString;
    runId: Type.TString;
    attempt: Type.TInteger;
    workspaceRoot: Type.TString;
    toolNames: Type.TArray<Type.TUnion<[Type.TLiteral<"read">, Type.TLiteral<"bash">, Type.TLiteral<"edit">, Type.TLiteral<"write">, Type.TLiteral<"grep">, Type.TLiteral<"find">, Type.TLiteral<"ls">]>>;
}>;
export type RunEnvelope = Static<typeof RunEnvelopeSchema>;
export declare function parseRunEnvelope(input: unknown): RunEnvelope;
