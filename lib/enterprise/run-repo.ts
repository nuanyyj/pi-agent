/**
 * PostgreSQL-backed run repository.
 *
 * Replaces the in-memory run store with persistent storage using
 * enterprise_runs and enterprise_run_events tables.
 *
 * Falls back to in-memory store when PI_POSTGRES_URL is not configured.
 */

import type { EnterpriseDatabase } from "@pi-web/enterprise-session-broker";
import type { AgentExecutionSnapshot } from "./agent-runtime";

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface RunRecord {
  id: string;
  conversationId: string;
  organizationId: string;
  status: RunStatus;
  modelProvider: string;
  modelId: string;
  agentId?: string;
  agentName?: string;
  userInput: string;
  response?: string;
  error?: string;
  eventCount: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  workerPid?: number;
}

export interface RunEvent {
  seq: number;
  type: string;
  timestamp: string;
  data: unknown;
}

// ── In-memory fallback ─────────────────────────────────────────────────

interface InMemoryRun {
  record: RunRecord;
  events: RunEvent[];
  executionSnapshot?: AgentExecutionSnapshot;
  abortController?: AbortController;
}

declare global {
  var __piRunStoreMem: Map<string, InMemoryRun> | undefined;
}

function getMemStore(): Map<string, InMemoryRun> {
  if (!globalThis.__piRunStoreMem) globalThis.__piRunStoreMem = new Map();
  return globalThis.__piRunStoreMem;
}

// ── Repository ─────────────────────────────────────────────────────────

export interface RunRepository {
  createRun(record: RunRecord, executionSnapshot?: AgentExecutionSnapshot): Promise<void>;
  getRunExecutionSnapshot(id: string): Promise<AgentExecutionSnapshot | null>;
  getRun(id: string): Promise<RunRecord | null>;
  listRuns(filter?: { conversationId?: string; organizationId?: string }): Promise<RunRecord[]>;
  updateRun(id: string, patch: Partial<RunRecord>): Promise<RunRecord | null>;
  appendRunEvent(id: string, event: Omit<RunEvent, "seq">): Promise<RunEvent | null>;
  getRunEvents(id: string, afterSeq?: number): Promise<RunEvent[]>;
  deleteRun(id: string): Promise<boolean>;
  setAbortController(id: string, controller: AbortController): void;
  getAbortController(id: string): AbortController | undefined;
}

// ── PG implementation ──────────────────────────────────────────────────

export function createPgRunRepository(db: EnterpriseDatabase): RunRepository {
  return {
    async createRun(record, executionSnapshot) {
      await db.query(
        `insert into enterprise_runs
           (id, conversation_id, organization_id, status, model_provider, model_id,
            user_input, agent_id, agent_snapshot, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [record.id, record.conversationId, record.organizationId, record.status,
          record.modelProvider, record.modelId, record.userInput, record.agentId ?? null,
          executionSnapshot ? JSON.stringify(executionSnapshot) : null, record.createdAt],
      );
    },

    async getRunExecutionSnapshot(id) {
      const { rows } = await db.query<{ agent_snapshot: AgentExecutionSnapshot | string | null }>(
        `select agent_snapshot from enterprise_runs where id = $1`,
        [id],
      );
      const value = rows[0]?.agent_snapshot;
      if (!value) return null;
      return typeof value === "string" ? JSON.parse(value) as AgentExecutionSnapshot : value;
    },

    async getRun(id) {
      const { rows } = await db.query<{
        id: string; conversation_id: string; organization_id: string; status: string;
        model_provider: string; model_id: string; user_input: string; agent_id: string | null; agent_snapshot: unknown;
        response: string | null; error: string | null;
        created_at: string; started_at: string | null; completed_at: string | null; worker_pid: number | null;
      }>(
        `select * from enterprise_runs where id = $1`,
        [id],
      );
      const row = rows[0];
      if (!row) return null;

      const { rows: eventRows } = await db.query<{ count: string }>(
        `select count(*)::text as count from enterprise_run_events where run_id = $1`,
        [id],
      );

      return toRunRecord(row, Number(eventRows[0]?.count ?? 0));
    },

    async listRuns(filter) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (filter?.conversationId) {
        conditions.push(`conversation_id = $${idx++}`);
        params.push(filter.conversationId);
      }
      if (filter?.organizationId) {
        conditions.push(`organization_id = $${idx++}`);
        params.push(filter.organizationId);
      }

      const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
      const { rows } = await db.query<{
        id: string; conversation_id: string; organization_id: string; status: string;
        model_provider: string; model_id: string; user_input: string; agent_id: string | null; agent_snapshot: unknown;
        response: string | null; error: string | null;
        created_at: string; started_at: string | null; completed_at: string | null; worker_pid: number | null;
      }>(
        `select * from enterprise_runs ${where} order by created_at desc limit 100`,
        params,
      );

      // Batch event counts
      const runIds = rows.map((r) => r.id);
      if (runIds.length === 0) return [];

      const { rows: countRows } = await db.query<{ run_id: string; count: string }>(
        `select run_id, count(*)::text as count from enterprise_run_events where run_id = any($1) group by run_id`,
        [runIds],
      );
      const countMap = new Map(countRows.map((r) => [r.run_id, Number(r.count)]));

      return rows.map((r) => toRunRecord(r, countMap.get(r.id) ?? 0));
    },

    async updateRun(id, patch) {
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (patch.status !== undefined) { sets.push(`status = $${idx++}`); params.push(patch.status); }
      if (patch.response !== undefined) { sets.push(`response = $${idx++}`); params.push(patch.response); }
      if (patch.error !== undefined) { sets.push(`error = $${idx++}`); params.push(patch.error); }
      if (patch.startedAt !== undefined) { sets.push(`started_at = $${idx++}`); params.push(patch.startedAt); }
      if (patch.completedAt !== undefined) { sets.push(`completed_at = $${idx++}`); params.push(patch.completedAt); }
      if (patch.workerPid !== undefined) { sets.push(`worker_pid = $${idx++}`); params.push(patch.workerPid); }

      if (sets.length === 0) return this.getRun(id);

      params.push(id);
      await db.query(
        `update enterprise_runs set ${sets.join(", ")} where id = $${idx}`,
        params,
      );

      return this.getRun(id);
    },

    async appendRunEvent(id, event) {
      // Get next sequence number
      const { rows: maxRows } = await db.query<{ max_seq: string | null }>(
        `select max(seq)::text as max_seq from enterprise_run_events where run_id = $1`,
        [id],
      );
      const seq = Number(maxRows[0]?.max_seq ?? 0) + 1;

      await db.query(
        `insert into enterprise_run_events (run_id, seq, event_type, event_data) values ($1, $2, $3, $4)`,
        [id, seq, event.type, JSON.stringify(event.data)],
      );

      // Notify SSE listeners across instances via PG NOTIFY
      await db.query("SELECT pg_notify('enterprise_run_events', $1 || ':' || $2)", [id, String(seq)]).catch(() => {});

      return { seq, type: event.type, timestamp: event.timestamp, data: event.data };
    },

    async getRunEvents(id, afterSeq) {
      const params: unknown[] = [id];
      let sql = `select seq, event_type, event_data, recorded_at from enterprise_run_events where run_id = $1`;
      if (afterSeq !== undefined) {
        sql += ` and seq > $2`;
        params.push(afterSeq);
      }
      sql += ` order by seq asc`;

      const { rows } = await db.query<{ seq: string; event_type: string; event_data: unknown; recorded_at: string }>(sql, params);

      return rows.map((r) => ({
        seq: Number(r.seq),
        type: r.event_type,
        timestamp: r.recorded_at,
        data: r.event_data,
      }));
    },

    async deleteRun(id) {
      const { rows } = await db.query<{ id: string }>(
        `delete from enterprise_runs where id = $1 returning id`,
        [id],
      );
      return rows.length > 0;
    },

    // Abort controllers are in-memory only (not persisted)
    setAbortController(_id, _controller) {
      // Not stored in PG — managed by the API layer
    },

    getAbortController(_id) {
      return undefined;
    },
  };
}

// ── In-memory implementation (fallback) ────────────────────────────────

export function createMemRunRepository(): RunRepository {
  const abortControllers = new Map<string, AbortController>();

  return {
    async createRun(record, executionSnapshot) {
      getMemStore().set(record.id, { record: { ...record }, events: [], executionSnapshot });
    },

    async getRunExecutionSnapshot(id) {
      return getMemStore().get(id)?.executionSnapshot ?? null;
    },

    async getRun(id) {
      return getMemStore().get(id)?.record ?? null;
    },

    async listRuns(filter) {
      const all = Array.from(getMemStore().values()).map((m) => m.record);
      if (!filter) return all;
      return all.filter((r) => {
        if (filter.conversationId && r.conversationId !== filter.conversationId) return false;
        if (filter.organizationId && r.organizationId !== filter.organizationId) return false;
        return true;
      });
    },

    async updateRun(id, patch) {
      const entry = getMemStore().get(id);
      if (!entry) return null;
      Object.assign(entry.record, patch);
      return entry.record;
    },

    async appendRunEvent(id, event) {
      const entry = getMemStore().get(id);
      if (!entry) return null;
      const seq = entry.events.length + 1;
      const fullEvent: RunEvent = { ...event, seq };
      entry.events.push(fullEvent);
      entry.record.eventCount = entry.events.length;
      return fullEvent;
    },

    async getRunEvents(id, afterSeq) {
      const entry = getMemStore().get(id);
      if (!entry) return [];
      if (afterSeq !== undefined) return entry.events.filter((e) => e.seq > afterSeq);
      return entry.events;
    },

    async deleteRun(id) {
      return getMemStore().delete(id);
    },

    setAbortController(id, controller) {
      abortControllers.set(id, controller);
    },

    getAbortController(id) {
      return abortControllers.get(id);
    },
  };
}

// ── Factory ────────────────────────────────────────────────────────────

let sharedRepo: RunRepository | null = null;

/**
 * Get or create the shared run repository.
 * Uses PG when PI_POSTGRES_URL is configured, falls back to in-memory.
 */
export async function getRunRepository(): Promise<RunRepository> {
  if (sharedRepo) return sharedRepo;

  const pgUrl = process.env.PI_POSTGRES_URL;
  if (pgUrl) {
    const { createEnterpriseDatabase } = await import("@pi-web/enterprise-session-broker");
    const db = await createEnterpriseDatabase(pgUrl);
    sharedRepo = createPgRunRepository(db);
  } else {
    sharedRepo = createMemRunRepository();
  }

  return sharedRepo;
}

// ── Helpers ────────────────────────────────────────────────────────────

function toRunRecord(row: {
  id: string; conversation_id: string; organization_id: string; status: string;
  model_provider: string; model_id: string; user_input: string; agent_id: string | null; agent_snapshot: unknown;
  response: string | null; error: string | null;
  created_at: string; started_at: string | null; completed_at: string | null; worker_pid: number | null;
}, eventCount: number): RunRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    organizationId: row.organization_id,
    status: row.status as RunStatus,
    modelProvider: row.model_provider,
    modelId: row.model_id,
    agentId: row.agent_id ?? undefined,
    agentName: getAgentName(row.agent_snapshot),
    userInput: row.user_input,
    response: row.response ?? undefined,
    error: row.error ?? undefined,
    eventCount,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    workerPid: row.worker_pid ?? undefined,
  };
}

function getAgentName(snapshot: unknown): string | undefined {
  if (!snapshot) return undefined;
  const value = typeof snapshot === "string" ? JSON.parse(snapshot) as unknown : snapshot;
  if (!value || typeof value !== "object") return undefined;
  const name = (value as { agentName?: unknown }).agentName;
  return typeof name === "string" ? name : undefined;
}
