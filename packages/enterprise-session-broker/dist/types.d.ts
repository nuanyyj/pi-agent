import type { SessionTreeEntry } from "@earendil-works/pi-agent-core";
export interface EnterpriseSessionMetadata {
    id: string;
    createdAt: string;
    organizationId: string;
    workspaceRoot: string;
    parentSessionId?: string;
    scope?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}
export interface BrokerSessionSnapshot {
    metadata: EnterpriseSessionMetadata;
    version: number;
    activeLeafId: string | null;
    entries: SessionTreeEntry[];
}
export interface BrokerConflict {
    ok: false;
    currentVersion: number;
    currentLeafId: string | null;
}
export interface BrokerSuccess<T> {
    ok: true;
    value: T;
}
export type BrokerResult<T> = BrokerSuccess<T> | BrokerConflict;
export interface CreateEnterpriseSessionOptions {
    organizationId: string;
    workspaceRoot: string;
    id?: string;
    parentSessionId?: string;
    scope?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}
export interface ListEnterpriseSessionOptions {
    organizationId: string;
    workspaceRoot?: string;
}
export interface AppendAndAdvanceInput {
    sessionId: string;
    expectedVersion: number;
    entry: SessionTreeEntry;
}
export interface MoveLeafInput {
    sessionId: string;
    expectedVersion: number;
    targetId: string | null;
}
export interface SessionBroker {
    createSession(options: CreateEnterpriseSessionOptions): Promise<BrokerSessionSnapshot>;
    openSessionById(sessionId: string, organizationId: string): Promise<BrokerSessionSnapshot>;
    openSession(metadata: EnterpriseSessionMetadata): Promise<BrokerSessionSnapshot>;
    listSessions(options: ListEnterpriseSessionOptions): Promise<EnterpriseSessionMetadata[]>;
    getEntry(sessionId: string, entryId: string): Promise<SessionTreeEntry | undefined>;
    getEntries(sessionId: string): Promise<SessionTreeEntry[]>;
    getPathToRoot(sessionId: string, leafId: string | null): Promise<SessionTreeEntry[]>;
    getLabel(sessionId: string, entryId: string): Promise<string | undefined>;
    appendAndAdvance(input: AppendAndAdvanceInput): Promise<BrokerResult<{
        version: number;
        entryId: string;
    }>>;
    moveLeaf(input: MoveLeafInput): Promise<BrokerResult<{
        version: number;
        leafId: string | null;
    }>>;
    forkSession(sourceMetadata: EnterpriseSessionMetadata, options: CreateEnterpriseSessionOptions & {
        entryId?: string;
        position?: "before" | "at";
    }): Promise<BrokerSessionSnapshot>;
    deleteSession(sessionId: string, organizationId: string): Promise<void>;
}
