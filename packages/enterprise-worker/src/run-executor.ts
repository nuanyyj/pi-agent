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

import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Model, Api, MutableModels } from "@earendil-works/pi-ai";
import { type AgentHarnessEvent } from "@earendil-works/pi-agent-core";
import type { RunEnvelope } from "@pi-web/enterprise-protocol";
import {
  createBrokeredHarness,
  type BrokeredHarnessResult,
} from "./brokered-runtime.js";
import { createEnterpriseDatabase, type EnterpriseDatabase } from "@pi-web/enterprise-session-broker";

// ── Types ──────────────────────────────────────────────────────────────

export interface RunResult {
  response: string;
  events: CollectedEvent[];
  usage?: { inputTokens: number; outputTokens: number };
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

// ── Model resolution ───────────────────────────────────────────────────

function resolveModel(
  models: MutableModels,
  provider: string,
  modelId: string,
): Model<Api> {
  models.refresh(provider).catch(() => { /* ignore refresh errors */ });
  const model = models.getModel(provider, modelId);
  if (!model) {
    throw new Error(
      `Model not found: ${provider}/${modelId}. ` +
      `Available providers: ${models.getProviders().map((p) => p.id).join(", ")}`,
    );
  }
  return model;
}

// ── PG event writer ────────────────────────────────────────────────────

export function createPgEventWriter(db: EnterpriseDatabase, runId: string) {
  let seq = 0;
  let pendingWrites = Promise.resolve();

  return {
    writeEvent(type: string, data: unknown): void {
      const eventSeq = ++seq;
      pendingWrites = pendingWrites.then(async () => {
        await db.query(
          `insert into enterprise_run_events (run_id, seq, event_type, event_data) values ($1, $2, $3, $4)`,
          [runId, eventSeq, type, JSON.stringify(data)],
        );
        await db.query("select pg_notify('enterprise_run_events', $1 || ':' || $2)", [runId, String(eventSeq)]);
      }).catch((err) => {
        // Non-fatal: log but don't crash the run
        process.stderr.write(`[run-executor] Failed to write event ${type}: ${err}\n`);
      });
    },
    async flush(): Promise<void> {
      await pendingWrites;
    },
    async updateRunStatus(status: string, patch?: { response?: string; error?: string }): Promise<void> {
      try {
        const sets = [`status = $1`];
        const params: unknown[] = [status];
        let idx = 2;
        if (patch?.response !== undefined) { sets.push(`response = $${idx++}`); params.push(patch.response); }
        if (patch?.error !== undefined) { sets.push(`error = $${idx++}`); params.push(patch.error); }
        if (status === "running") { sets.push(`started_at = now()`); }
        if (status === "completed" || status === "failed" || status === "cancelled") { sets.push(`completed_at = now()`); }
        params.push(runId);
        await db.query(`update enterprise_runs set ${sets.join(", ")} where id = $${idx}`, params);
      } catch (err) {
        process.stderr.write(`[run-executor] Failed to update run status: ${err}\n`);
      }
    },
  };
}

// ── Event collection ───────────────────────────────────────────────────

function createEventCollector() {
  const events: CollectedEvent[] = [];
  function collect(event: AgentHarnessEvent): void {
    events.push({
      type: event.type,
      timestamp: new Date().toISOString(),
      data: sanitizeEventData(event),
    });
  }
  return { events, collect };
}

function sanitizeEventData(event: AgentHarnessEvent): unknown {
  const data = { ...event } as Record<string, unknown>;
  delete data.apiKey;
  delete data.apiKeyHash;
  delete data.headers;
  delete data.token;
  return data;
}

// ── Run Executor ───────────────────────────────────────────────────────

export async function executeRun(options: RunExecutorOptions): Promise<RunResult> {
  const { pgUrl, envelope, runId, signal } = options;
  const startTime = Date.now();

  const db: EnterpriseDatabase = await createEnterpriseDatabase(pgUrl);
  const pgWriter = runId ? createPgEventWriter(db, runId) : null;

  try {
    // Mark run as running
    await pgWriter?.updateRunStatus("running");

    // Resolve model
    const models: MutableModels = builtinModels();
    const model = resolveModel(models, envelope.modelProvider, envelope.modelId);

    // Create brokered harness
    const harnessResult: BrokeredHarnessResult = await createBrokeredHarness({
      db,
      envelope,
      models,
      model,
      ...(envelope.systemPrompt ? { systemPrompt: envelope.systemPrompt } : {}),
    });

    const { harness } = harnessResult;

    // Subscribe to events — collect locally + write to PG
    const { events, collect } = createEventCollector();
    const unsubscribe = harness.subscribe((event) => {
      collect(event);
      // Write to PG in real-time (fire-and-forget)
      pgWriter?.writeEvent(event.type, sanitizeEventData(event));
    });

    // Wire abort signal
    if (signal) {
      signal.addEventListener("abort", () => {
        harness.abort().catch(() => { /* ignore abort errors */ });
      });
    }

    // Execute prompt
    let response: string;
    try {
      const result = await harness.prompt(envelope.userInput);
      response = typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content);
    } catch (err) {
      if (signal?.aborted) {
        await pgWriter?.updateRunStatus("cancelled", { response: "[Run cancelled]" });
        return {
          response: "[Run cancelled]",
          events,
          durationMs: Date.now() - startTime,
        };
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      await pgWriter?.updateRunStatus("failed", { error: errMsg });
      throw err;
    } finally {
      unsubscribe();
      await pgWriter?.flush();
    }

    // Mark completed
    await pgWriter?.updateRunStatus("completed", { response });

    return {
      response,
      events,
      durationMs: Date.now() - startTime,
    };
  } finally {
    await db.close().catch(() => { /* ignore cleanup errors */ });
  }
}

export async function runFromEnvelopePath(
  envelopePath: string,
  pgUrl: string,
  runId?: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  const { readFile } = await import("node:fs/promises");
  const { parseRunEnvelope } = await import("@pi-web/enterprise-protocol");

  const raw = JSON.parse(await readFile(envelopePath, "utf8"));
  const envelope = parseRunEnvelope(raw);

  return executeRun({ pgUrl, envelope, runId, signal });
}
