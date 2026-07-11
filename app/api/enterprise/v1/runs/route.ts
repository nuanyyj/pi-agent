import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import { createRun, listRuns, type RunRecord } from "@/lib/enterprise/run-store";
import { randomUUID } from "node:crypto";
import { writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

/**
 * POST /api/enterprise/v1/runs
 * Create a new enterprise run. Spawns the worker process to execute the agent.
 */
export async function POST(req: Request) {
  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  try {
    const body = (await req.json()) as {
      conversationId: string;
      organizationId?: string;
      workspaceRoot?: string;
      modelProvider: string;
      modelId: string;
      userInput: string;
      systemPrompt?: string;
      toolNames?: string[];
    };

    if (!body.conversationId || !body.modelProvider || !body.modelId || !body.userInput) {
      return NextResponse.json(
        { error: "conversationId, modelProvider, modelId, and userInput are required" },
        { status: 400 },
      );
    }

    const runId = randomUUID();
    const attempt = 1;
    const now = new Date().toISOString();

    const record: RunRecord = {
      id: runId,
      conversationId: body.conversationId,
      organizationId: body.organizationId ?? "default",
      runId,
      attempt,
      status: "pending",
      modelProvider: body.modelProvider,
      modelId: body.modelId,
      userInput: body.userInput,
      events: [],
      createdAt: now,
    };

    createRun(record);

    // Spawn worker process asynchronously
    spawnWorker(record, body).catch((err) => {
      console.error("[enterprise-run] worker spawn failed:", err);
      record.status = "failed";
      record.error = err instanceof Error ? err.message : String(err);
      record.completedAt = new Date().toISOString();
    });

    return NextResponse.json({
      id: record.id,
      conversationId: record.conversationId,
      status: record.status,
      modelProvider: record.modelProvider,
      modelId: record.modelId,
      createdAt: record.createdAt,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

/**
 * GET /api/enterprise/v1/runs
 * List enterprise runs.
 */
export async function GET(req: Request) {
  if (!isEnterpriseEnabled()) {
    return NextResponse.json({ error: "Enterprise mode not enabled" }, { status: 503 });
  }

  try {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversationId") ?? undefined;
    const organizationId = url.searchParams.get("organizationId") ?? undefined;

    const runs = listRuns({ conversationId, organizationId });

    return NextResponse.json({
      runs: runs.map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        status: r.status,
        modelProvider: r.modelProvider,
        modelId: r.modelId,
        response: r.response,
        error: r.error,
        eventCount: r.events.length,
        createdAt: r.createdAt,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

// ── Worker process spawning ────────────────────────────────────────────

interface RunBody {
  conversationId: string;
  organizationId?: string;
  workspaceRoot?: string;
  modelProvider: string;
  modelId: string;
  userInput: string;
  systemPrompt?: string;
  toolNames?: string[];
}

async function spawnWorker(record: RunRecord, body: RunBody): Promise<void> {
  // Write envelope to temp file
  const tmpDir = await mkdtemp(join(tmpdir(), "pi-run-"));
  const envelopePath = join(tmpDir, "envelope.json");

  const envelope = {
    protocolVersion: 1,
    runtimeProfile: "agent-harness-v1",
    organizationId: record.organizationId,
    conversationId: body.conversationId,
    runId: record.runId,
    attempt: record.attempt,
    workspaceRoot: body.workspaceRoot ?? process.cwd(),
    toolNames: body.toolNames ?? ["read", "bash", "edit", "write"],
    modelProvider: body.modelProvider,
    modelId: body.modelId,
    userInput: body.userInput,
    ...(body.systemPrompt ? { systemPrompt: body.systemPrompt } : {}),
  };

  await writeFile(envelopePath, JSON.stringify(envelope), "utf8");

  record.status = "running";
  record.startedAt = new Date().toISOString();

  // Resolve worker entry point
  const workerPath = join(
    process.cwd(),
    "packages",
    "enterprise-worker",
    "dist",
    "main.js",
  );

  const child = spawn(process.execPath, [workerPath], {
    env: {
      ...process.env,
      PI_RUN_ENVELOPE_PATH: envelopePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  record.workerPid = child.pid;

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on("close", (code) => {
    record.completedAt = new Date().toISOString();
    record.workerPid = undefined;

    if (code === 0) {
      try {
        const result = JSON.parse(stdout.trim().split("\n").pop() ?? "{}");
        record.status = "completed";
        record.response = result.response ?? stdout;
      } catch {
        record.status = "completed";
        record.response = stdout;
      }
    } else {
      record.status = "failed";
      record.error = stderr || `Worker exited with code ${code}`;
    }
  });

  child.on("error", (err) => {
    record.status = "failed";
    record.error = err.message;
    record.completedAt = new Date().toISOString();
  });
}
