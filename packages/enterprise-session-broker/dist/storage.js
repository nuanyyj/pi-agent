import { SessionError, } from "@earendil-works/pi-agent-core";
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
export class BrokeredSessionStorage {
    broker;
    metadata;
    expectedVersion;
    leafId;
    constructor(options) {
        this.broker = options.broker;
        this.metadata = options.metadata;
        this.expectedVersion = options.initialVersion;
        this.leafId = options.initialLeafId;
    }
    // ── reads ──────────────────────────────────────────────────────────
    async getMetadata() {
        return this.metadata;
    }
    async getLeafId() {
        return this.leafId;
    }
    async createEntryId() {
        const { randomUUID } = await import("node:crypto");
        return randomUUID();
    }
    async getEntry(id) {
        return this.broker.getEntry(this.metadata.id, id);
    }
    async findEntries(type) {
        const entries = await this.broker.getEntries(this.metadata.id);
        return entries.filter((e) => e.type === type);
    }
    async getLabel(id) {
        return this.broker.getLabel(this.metadata.id, id);
    }
    async getPathToRoot(leafId) {
        return this.broker.getPathToRoot(this.metadata.id, leafId);
    }
    async getEntries() {
        return this.broker.getEntries(this.metadata.id);
    }
    // ── mutations (through broker, version-tracked) ────────────────────
    async setLeafId(leafId) {
        const result = await this.broker.moveLeaf({
            sessionId: this.metadata.id,
            expectedVersion: this.expectedVersion,
            targetId: leafId,
        });
        if (!result.ok) {
            this.reconcileVersion(result.currentVersion, result.currentLeafId);
            throw conflictError(this.metadata.id, result.currentVersion);
        }
        this.expectedVersion = result.value.version;
        this.leafId = result.value.leafId;
    }
    async appendEntry(entry) {
        const result = await this.broker.appendAndAdvance({
            sessionId: this.metadata.id,
            expectedVersion: this.expectedVersion,
            entry,
        });
        if (!result.ok) {
            this.reconcileVersion(result.currentVersion, result.currentLeafId);
            throw conflictError(this.metadata.id, result.currentVersion);
        }
        this.expectedVersion = result.value.version;
        const leafId = resolveLeafId(entry);
        if (leafId !== undefined) {
            this.leafId = leafId;
        }
    }
    // ── internal ───────────────────────────────────────────────────────
    reconcileVersion(durableVersion, durableLeafId) {
        this.expectedVersion = durableVersion;
        this.leafId = durableLeafId;
    }
}
// ── helpers ────────────────────────────────────────────────────────────
function conflictError(sessionId, currentVersion) {
    return new SessionError("invalid_session", `Version conflict on session ${sessionId}: expected ${currentVersion}`);
}
/**
 * Returns the leaf target for entries that carry one, or undefined for
 * entries that do not affect the active leaf.
 */
function resolveLeafId(entry) {
    if (entry.type === "leaf")
        return entry.targetId ?? undefined;
    if (entry.type === "message" || entry.type === "compaction" || entry.type === "custom_message" || entry.type === "custom") {
        return entry.id;
    }
    return undefined;
}
//# sourceMappingURL=storage.js.map