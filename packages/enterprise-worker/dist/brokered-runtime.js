import { AgentHarness, SessionError } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createSessionBroker, PostgresSessionRepo, } from "@pi-web/enterprise-session-broker";
import { createApprovedCodingTools } from "./coding-tools.js";
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
    let session;
    try {
        session = await repo.open(metadata);
    }
    catch (err) {
        if (!(err instanceof SessionError && err.code === "not_found"))
            throw err;
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