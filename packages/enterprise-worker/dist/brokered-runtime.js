import { AgentHarness, SessionError, } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createSessionBroker, PostgresSessionRepo, } from "@pi-web/enterprise-session-broker";
import { createApprovedCodingTools } from "./coding-tools.js";
/**
 * Create an AgentHarness backed by a PostgreSQL-brokered session.
 *
 * Opens an existing enterprise session for the conversation or creates a new
 * one. Handles concurrent creation gracefully by retrying open after a
 * failed create (duplicate key from a racing worker).
 */
export async function createBrokeredHarness(options) {
    const { db, envelope, ...harnessOptions } = options;
    const broker = createSessionBroker(db);
    const repo = new PostgresSessionRepo(broker);
    const metadata = {
        id: envelope.conversationId,
        createdAt: new Date().toISOString(),
        organizationId: envelope.organizationId,
        workspaceRoot: envelope.workspaceRoot,
    };
    const session = await openOrCreateSession(repo, metadata, envelope);
    const tools = createApprovedCodingTools(envelope.workspaceRoot, envelope.toolNames);
    const harness = new AgentHarness({
        ...harnessOptions,
        session,
        env: new NodeExecutionEnv({ cwd: envelope.workspaceRoot }),
        tools,
        activeToolNames: tools.map((t) => t.name),
    });
    return { harness, session, metadata: await session.getMetadata() };
}
async function openOrCreateSession(repo, metadata, envelope) {
    try {
        return await repo.open(metadata);
    }
    catch (err) {
        if (!(err instanceof SessionError && err.code === "not_found"))
            throw err;
    }
    // Session does not exist yet — create it. If a concurrent worker races
    // us and creates the same session first, the create will fail on the
    // unique constraint. In that case we retry the open.
    try {
        return await repo.create({
            organizationId: envelope.organizationId,
            workspaceRoot: envelope.workspaceRoot,
            id: envelope.conversationId,
        });
    }
    catch {
        // Another worker won the race. Re-open the now-existing session.
        return repo.open(metadata);
    }
}
//# sourceMappingURL=brokered-runtime.js.map