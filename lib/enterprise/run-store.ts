/**
 * In-memory run store for Phase 1B.
 *
 * Tracks run lifecycle state and collects events from worker processes.
 * This is a development/staging implementation; production will use
 * PostgreSQL-backed run_events table.
 *
 * Each run has:
 * - metadata (id, conversationId, status, timestamps)
 * - events (collected from worker stdout as NDJSON)
 * - an optional AbortController for cancellation
 */

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface RunRecord {
  id: string;
  conversationId: string;
  organizationId: string;
  runId: string;
  attempt: number;
  status: RunStatus;
  modelProvider: string;
  modelId: string;
  userInput: string;
  response?: string;
  error?: string;
  events: RunEvent[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  abortController?: AbortController;
  workerPid?: number;
}

export interface RunEvent {
  seq: number;
  type: string;
  timestamp: string;
  data: unknown;
}

declare global {
  var __piRunStore: Map<string, RunRecord> | undefined;
}

function getStore(): Map<string, RunRecord> {
  if (!globalThis.__piRunStore) globalThis.__piRunStore = new Map();
  return globalThis.__piRunStore;
}

export function createRun(record: RunRecord): void {
  getStore().set(record.id, record);
}

export function getRun(id: string): RunRecord | undefined {
  return getStore().get(id);
}

export function listRuns(filter?: { conversationId?: string; organizationId?: string }): RunRecord[] {
  const runs = Array.from(getStore().values());
  if (!filter) return runs;
  return runs.filter((r) => {
    if (filter.conversationId && r.conversationId !== filter.conversationId) return false;
    if (filter.organizationId && r.organizationId !== filter.organizationId) return false;
    return true;
  });
}

export function updateRun(id: string, patch: Partial<RunRecord>): RunRecord | undefined {
  const run = getStore().get(id);
  if (!run) return undefined;
  Object.assign(run, patch);
  return run;
}

export function appendRunEvent(id: string, event: Omit<RunEvent, "seq">): RunEvent | undefined {
  const run = getStore().get(id);
  if (!run) return undefined;
  const seq = run.events.length + 1;
  const fullEvent: RunEvent = { ...event, seq };
  run.events.push(fullEvent);
  return fullEvent;
}

export function deleteRun(id: string): boolean {
  return getStore().delete(id);
}
