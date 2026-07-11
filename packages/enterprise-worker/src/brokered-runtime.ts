import { AgentHarness, SessionError, type AgentHarnessOptions, type AgentTool, type Session } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
  createSessionBroker,
  PostgresSessionRepo,
  type EnterpriseDatabase,
  type EnterpriseSessionMetadata,
} from "@pi-web/enterprise-session-broker";
import type { RunEnvelope, EnterpriseCodingToolName } from "@pi-web/enterprise-protocol";
import { createApprovedCodingTools } from "./coding-tools.js";

export interface CreateBrokeredHarnessOptions
  extends Omit<AgentHarnessOptions, "env" | "tools" | "activeToolNames" | "session"> {
  db: EnterpriseDatabase;
  envelope: RunEnvelope;
}

export interface BrokeredHarnessResult {
  harness: AgentHarness;
  session: Session<EnterpriseSessionMetadata>;
  metadata: EnterpriseSessionMetadata;
}

export async function createBrokeredHarness(
  options: CreateBrokeredHarnessOptions,
): Promise<BrokeredHarnessResult> {
  const { db, envelope, ...harnessOptions } = options;
  const broker = createSessionBroker(db);
  const repo = new PostgresSessionRepo(broker);
  const metadata: EnterpriseSessionMetadata = {
    id: envelope.conversationId,
    createdAt: new Date().toISOString(),
    organizationId: envelope.organizationId,
    workspaceRoot: envelope.workspaceRoot,
  };
  let session: Session<EnterpriseSessionMetadata>;
  try {
    session = await repo.open(metadata);
  } catch (err: unknown) {
    if (!(err instanceof SessionError && err.code === "not_found")) throw err;
    session = await repo.create({
      organizationId: envelope.organizationId,
      workspaceRoot: envelope.workspaceRoot,
      id: envelope.conversationId,
    });
  }
  const tools: AgentTool[] = createApprovedCodingTools(
    envelope.workspaceRoot,
    envelope.toolNames as readonly EnterpriseCodingToolName[],
  );
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
