#!/usr/bin/env node
/**
 * Enterprise Worker — Phase 1A
 *
 * Reads a RunEnvelope from PI_RUN_ENVELOPE_PATH, validates it, and executes
 * the agent run against PostgreSQL-backed sessions.
 *
 * Environment variables:
 *   PI_RUN_ENVELOPE_PATH  — path to the RunEnvelope JSON file (required)
 *   PI_POSTGRES_URL       — PostgreSQL connection string (required)
 *   OPENAI_API_KEY / ANTHROPIC_API_KEY / etc. — model provider API keys
 */
import { runFromEnvelopePath } from "./run-executor.js";

async function main(): Promise<void> {
  const envelopePath = process.env.PI_RUN_ENVELOPE_PATH;
  if (!envelopePath) throw new Error("PI_RUN_ENVELOPE_PATH is required");

  const pgUrl = process.env.PI_POSTGRES_URL;
  if (!pgUrl) throw new Error("PI_POSTGRES_URL is required");

  const result = await runFromEnvelopePath(envelopePath, pgUrl);

  // Write result to stdout as JSON
  process.stdout.write(JSON.stringify({
    response: result.response,
    eventCount: result.events.length,
    durationMs: result.durationMs,
    usage: result.usage ?? null,
  }) + "\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
