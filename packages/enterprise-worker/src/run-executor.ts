/**
 * Run Executor — Phase 1A
 *
 * Executes an enterprise run: parses the RunEnvelope, connects to PostgreSQL,
 * creates a brokered AgentHarness, loads the model, runs the prompt, and
 * collects harness events.
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
  /** Final assistant response text */
  response: string;
  /** All harness events emitted during the run */
  events: CollectedEvent[];
  /** Total token usage if reported by the provider */
  usage?: { inputTokens: number; outputTokens: number };
  /** Duration in milliseconds */
  durationMs: number;
}

export interface CollectedEvent {
  type: string;
  timestamp: string;
  data: unknown;
}

export interface RunExecutorOptions {
  /** PostgreSQL connection string */
  pgUrl: string;
  /** Parsed and validated RunEnvelope */
  envelope: RunEnvelope;
  /** Optional abort signal for cancellation */
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

/**
 * Strip sensitive fields from harness events before storage.
 * API keys, tokens, and raw provider payloads are excluded.
 */
function sanitizeEventData(event: AgentHarnessEvent): unknown {
  const data = { ...event } as Record<string, unknown>;
  delete data.apiKey;
  delete data.apiKeyHash;
  delete data.headers;
  delete data.token;
  return data;
}

// ── Run Executor ───────────────────────────────────────────────────────

/**
 * Execute an enterprise run end-to-end.
 *
 * Flow:
 * 1. Connect to PostgreSQL
 * 2. Resolve model from built-in providers (API keys from env vars)
 * 3. Create brokered harness (opens or creates session in PG)
 * 4. Subscribe to harness events
 * 5. Execute prompt
 * 6. Collect and return results
 */
export async function executeRun(options: RunExecutorOptions): Promise<RunResult> {
  const { pgUrl, envelope, signal } = options;
  const startTime = Date.now();

  // 1. Connect to PostgreSQL
  const db: EnterpriseDatabase = await createEnterpriseDatabase(pgUrl);

  try {
    // 2. Resolve model (needed by both createBrokeredHarness and harness.setModel)
    const models: MutableModels = builtinModels();
    const model = resolveModel(models, envelope.modelProvider, envelope.modelId);

    // 3. Create brokered harness with models + model
    const harnessResult: BrokeredHarnessResult = await createBrokeredHarness({
      db,
      envelope,
      models,
      model,
    });

    const { harness } = harnessResult;

    // 4. Subscribe to events
    const { events, collect } = createEventCollector();
    const unsubscribe = harness.subscribe((event) => {
      collect(event);
    });

    // Wire abort signal
    if (signal) {
      signal.addEventListener("abort", () => {
        harness.abort().catch(() => { /* ignore abort errors */ });
      });
    }

    // 5. Execute prompt
    let response: string;
    try {
      const result = await harness.prompt(envelope.userInput);
      response = typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content);
    } catch (err) {
      if (signal?.aborted) {
        return {
          response: "[Run cancelled]",
          events,
          durationMs: Date.now() - startTime,
        };
      }
      throw err;
    } finally {
      unsubscribe();
    }

    // 6. Return results
    return {
      response,
      events,
      durationMs: Date.now() - startTime,
    };
  } finally {
    await db.close().catch(() => { /* ignore cleanup errors */ });
  }
}

/**
 * Lightweight preflight + execution entry point.
 * Reads the envelope from a file and runs the executor.
 */
export async function runFromEnvelopePath(
  envelopePath: string,
  pgUrl: string,
  signal?: AbortSignal,
): Promise<RunResult> {
  const { readFile } = await import("node:fs/promises");
  const { parseRunEnvelope } = await import("@pi-web/enterprise-protocol");

  const raw = JSON.parse(await readFile(envelopePath, "utf8"));
  const envelope = parseRunEnvelope(raw);

  return executeRun({ pgUrl, envelope, signal });
}
