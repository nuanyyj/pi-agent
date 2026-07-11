import { Session, } from "@earendil-works/pi-agent-core";
import { BrokeredSessionStorage, } from "./storage.js";
/**
 * SessionRepo adapter backed by the enterprise session broker.
 *
 * Creates, opens, lists, deletes, and forks enterprise sessions through
 * the broker's atomic mutation layer. Every Session returned is backed
 * by a BrokeredSessionStorage that routes writes through PostgreSQL.
 */
export class PostgresSessionRepo {
    broker;
    constructor(broker) {
        this.broker = broker;
    }
    async create(options) {
        const snapshot = await this.broker.createSession(options);
        return new Session(this.storageFromSnapshot(snapshot));
    }
    async open(metadata) {
        const snapshot = await this.broker.openSession(metadata);
        return new Session(this.storageFromSnapshot(snapshot));
    }
    async list(options) {
        if (!options)
            return [];
        return this.broker.listSessions(options);
    }
    async delete(metadata) {
        await this.broker.deleteSession(metadata.id, metadata.organizationId);
    }
    async fork(source, options) {
        const snapshot = await this.broker.forkSession(source, {
            organizationId: options.organizationId ?? source.organizationId,
            workspaceRoot: options.workspaceRoot ?? source.workspaceRoot,
            id: options.id,
            entryId: options.entryId,
            position: options.position,
        });
        return new Session(this.storageFromSnapshot(snapshot));
    }
    storageFromSnapshot(snapshot) {
        return new BrokeredSessionStorage({
            broker: this.broker,
            metadata: snapshot.metadata,
            initialVersion: snapshot.version,
            initialLeafId: snapshot.activeLeafId,
        });
    }
}
//# sourceMappingURL=repo.js.map