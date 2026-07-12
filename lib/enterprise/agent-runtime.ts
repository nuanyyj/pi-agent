import type { EnterpriseDatabase } from "@pi-web/enterprise-session-broker";
import type { EnterpriseCodingToolName } from "@pi-web/enterprise-protocol";

const APPROVED_TOOLS = new Set<EnterpriseCodingToolName>([
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
]);

export interface AgentExecutionSnapshot {
  source: "agent" | "request";
  agentId?: string;
  agentName?: string;
  modelProvider: string;
  modelId: string;
  toolNames: EnterpriseCodingToolName[];
  systemPrompt?: string;
  resolvedAt: string;
}

export interface ResolveExecutionInput {
  organizationId: string;
  agentId?: string;
  modelProvider?: string;
  modelId?: string;
  toolNames?: string[];
  systemPrompt?: string;
}

export class AgentRuntimeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}

/** Resolve and freeze the execution configuration used by a Run. */
export async function resolveExecutionSnapshot(
  db: EnterpriseDatabase,
  input: ResolveExecutionInput,
): Promise<AgentExecutionSnapshot> {
  if (input.agentId) {
    const result = await db.query<{
      id: string;
      name: string;
      system_prompt: string;
      default_model_provider: string;
      default_model_id: string;
      default_tools: unknown;
      is_active: boolean;
    }>(
      `select id, name, system_prompt, default_model_provider, default_model_id,
              default_tools, is_active
       from enterprise_agents
       where id = $1 and organization_id = $2`,
      [input.agentId, input.organizationId],
    );
    const agent = result.rows[0];
    if (!agent) throw new AgentRuntimeError("Agent not found", 404);
    if (!agent.is_active) throw new AgentRuntimeError("Agent is inactive", 409);

    return {
      source: "agent",
      agentId: agent.id,
      agentName: agent.name,
      modelProvider: requireText(agent.default_model_provider, "Agent model provider"),
      modelId: requireText(agent.default_model_id, "Agent model ID"),
      toolNames: validateToolNames(agent.default_tools),
      ...(agent.system_prompt ? { systemPrompt: agent.system_prompt } : {}),
      resolvedAt: new Date().toISOString(),
    };
  }

  return {
    source: "request",
    modelProvider: requireText(input.modelProvider, "modelProvider"),
    modelId: requireText(input.modelId, "modelId"),
    toolNames: validateToolNames(input.toolNames ?? ["read", "bash", "edit", "write"]),
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    resolvedAt: new Date().toISOString(),
  };
}

function requireText(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new AgentRuntimeError(`${field} is required`, 400);
  return normalized;
}

function validateToolNames(value: unknown): EnterpriseCodingToolName[] {
  if (!Array.isArray(value)) {
    throw new AgentRuntimeError("toolNames must be an array", 400);
  }
  const tools: EnterpriseCodingToolName[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !APPROVED_TOOLS.has(item as EnterpriseCodingToolName)) {
      throw new AgentRuntimeError(`Unsupported tool: ${String(item)}`, 400);
    }
    if (seen.has(item)) throw new AgentRuntimeError(`Duplicate tool: ${item}`, 400);
    seen.add(item);
    tools.push(item as EnterpriseCodingToolName);
  }
  return tools;
}
