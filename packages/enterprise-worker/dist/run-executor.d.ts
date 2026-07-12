/**
 * Run Executor — Phase 1A
 *
 * Executes an enterprise run: parses the RunEnvelope, connects to PostgreSQL,
 * creates a brokered AgentHarness, loads the model, runs the prompt, and
 * collects harness events.
 *
 * When runId is provided, events are written to enterprise_run_events in
 * real-time for live SSE streaming.
 *
 * Design doc: docs/superpowers/specs/2026-07-10-enterprise-agent-platform-design.md §7.5
 */
import type { RunEnvelope } from "@pi-web/enterprise-protocol";
import { type EnterpriseDatabase } from "@pi-web/enterprise-session-broker";
export interface RunResult {
    response: string;
    events: CollectedEvent[];
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    durationMs: number;
}
export interface CollectedEvent {
    type: string;
    timestamp: string;
    data: unknown;
}
export interface RunExecutorOptions {
    pgUrl: string;
    envelope: RunEnvelope;
    /** Run ID for PG event persistence. When set, events write to enterprise_run_events. */
    runId?: string;
    signal?: AbortSignal;
}
export declare function createPgEventWriter(db: EnterpriseDatabase, runId: string): {
    writeEvent(type: string, data: unknown): void;
    flush(): Promise<void>;
    updateRunStatus(status: string, patch?: {
        response?: string;
        error?: string;
    }): Promise<void>;
};
export declare function executeRun(options: RunExecutorOptions): Promise<RunResult>;
export declare function runFromEnvelopePath(envelopePath: string, pgUrl: string, runId?: string, signal?: AbortSignal): Promise<RunResult>;
