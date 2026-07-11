import { type SessionStorage, type SessionTreeEntry } from "@earendil-works/pi-agent-core";
import type { EnterpriseSessionMetadata, SessionBroker } from "./types.js";
export interface BrokeredSessionStorageOptions {
    broker: SessionBroker;
    metadata: EnterpriseSessionMetadata;
    initialVersion: number;
    initialLeafId: string | null;
}
/**
 * SessionStorage adapter backed by the enterprise session broker.
 *
 * Every mutation (appendEntry, setLeafId) goes through the broker's atomic
 * compare-and-set path. The expected version is tracked locally and refreshed
 * from the broker conflict response on stale-write detection.
 *
 * This is the bridge that lets AgentHarness use PostgreSQL sessions without
 * knowing about the database or versioning protocol.
 */
export declare class BrokeredSessionStorage implements SessionStorage<EnterpriseSessionMetadata> {
    private readonly broker;
    private readonly metadata;
    private expectedVersion;
    private leafId;
    constructor(options: BrokeredSessionStorageOptions);
    getMetadata(): Promise<EnterpriseSessionMetadata>;
    getLeafId(): Promise<string | null>;
    createEntryId(): Promise<string>;
    getEntry(id: string): Promise<SessionTreeEntry | undefined>;
    findEntries<TType extends SessionTreeEntry["type"]>(type: TType): Promise<Array<Extract<SessionTreeEntry, {
        type: TType;
    }>>>;
    getLabel(id: string): Promise<string | undefined>;
    getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
    getEntries(): Promise<SessionTreeEntry[]>;
    setLeafId(leafId: string | null): Promise<void>;
    appendEntry(entry: SessionTreeEntry): Promise<void>;
    private reconcileVersion;
}
