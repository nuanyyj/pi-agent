import { Session, type SessionRepo } from "@earendil-works/pi-agent-core";
import type { CreateEnterpriseSessionOptions, EnterpriseSessionMetadata, ListEnterpriseSessionOptions, SessionBroker } from "./types.js";
/**
 * SessionRepo adapter backed by the enterprise session broker.
 *
 * Creates, opens, lists, deletes, and forks enterprise sessions through
 * the broker's atomic mutation layer. Every Session returned is backed
 * by a BrokeredSessionStorage that routes writes through PostgreSQL.
 */
export declare class PostgresSessionRepo implements SessionRepo<EnterpriseSessionMetadata, CreateEnterpriseSessionOptions, ListEnterpriseSessionOptions> {
    private readonly broker;
    constructor(broker: SessionBroker);
    create(options: CreateEnterpriseSessionOptions): Promise<Session<EnterpriseSessionMetadata>>;
    open(metadata: EnterpriseSessionMetadata): Promise<Session<EnterpriseSessionMetadata>>;
    list(options?: ListEnterpriseSessionOptions): Promise<EnterpriseSessionMetadata[]>;
    delete(metadata: EnterpriseSessionMetadata): Promise<void>;
    fork(source: EnterpriseSessionMetadata, options: {
        entryId?: string;
        position?: "before" | "at";
        id?: string;
        organizationId?: string;
        workspaceRoot?: string;
    }): Promise<Session<EnterpriseSessionMetadata>>;
    private storageFromSnapshot;
}
