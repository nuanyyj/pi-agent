import { AgentHarness } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createSessionBroker, PostgresSessionRepo, } from "@pi-web/enterprise-session-broker";
import { createApprovedCodingTools } from "./coding-tools.js";
/**
 * Create an AgentHarness backed by a PostgreSQL-brokered session.
 *
 * Opens an existing enterprise session for the conversation or creates a new
 * one. The session is persisted through the versioned broker so mutations
 * survive worker restarts and reject stale concurrent writes.
 */
export async function createBrokeredHarness(options) {
    const { db, envelope, ...harnessOptions } = options;
    const broker = createSessionBroker(db);
    const repo = new PostgresSessionRepo(broker);
    // Try to open an existing session for this conversation, or create one.
    const metadata = {
        id: envelope.conversationId,
        createdAt: new Date().toISOString(),
        organizationId: envelope.organizationId,
        workspaceRoot: envelope.workspaceRoot,
    };
    let session;
    try {
        session = await repo.open(metadata);
    }
    catch {
        session = await repo.create({
            organizationId: envelope.organizationId,
            workspaceRoot: envelope.workspaceRoot,
            id: envelope.conversationId,
        });
    }
    const tools = createApprovedCodingTools(envelope.workspaceRoot, envelope.toolNames);
    const harness = new AgentHarness({
        ...harnessOptions,
        session,
        env: new NodeExecutionEnv({ cwd: envelope.workspaceRoot }),
        tools,
        activeToolNames: tools.map((t) => t.name),
    });
    return {
        harness,
        session,
        metadata: await session.getMetadata(),
    };
}
//# sourceMappingURL=brokered-runtime.js.map