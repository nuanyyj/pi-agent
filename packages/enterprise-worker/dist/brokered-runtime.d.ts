import { AgentHarness, type AgentHarnessOptions, type Session } from "@earendil-works/pi-agent-core";
import { type EnterpriseDatabase, type EnterpriseSessionMetadata } from "@pi-web/enterprise-session-broker";
import type { RunEnvelope } from "@pi-web/enterprise-protocol";
export interface CreateBrokeredHarnessOptions extends Omit<AgentHarnessOptions, "env" | "tools" | "activeToolNames" | "session"> {
    db: EnterpriseDatabase;
    envelope: RunEnvelope;
}
export interface BrokeredHarnessResult {
    harness: AgentHarness;
    session: Session<EnterpriseSessionMetadata>;
    metadata: EnterpriseSessionMetadata;
}
/**
 * Create an AgentHarness backed by a PostgreSQL-brokered session.
 *
 * Opens an existing enterprise session for the conversation or creates a new
 * one. Handles concurrent creation gracefully by retrying open after a
 * failed create (duplicate key from a racing worker).
 */
export declare function createBrokeredHarness(options: CreateBrokeredHarnessOptions): Promise<BrokeredHarnessResult>;
