import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getRunRepository, type RunRecord } from "@/lib/enterprise/run-repo";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";
import { authenticateRequest } from "@/lib/enterprise/auth";
import { checkQuota, recordUsage } from "@/lib/enterprise/quota";
import { requirePermission } from "@/lib/enterprise/rbac";
import { writeAuditEvent } from "@/lib/enterprise/audit-log";
import { getEnterpriseDb } from "@/lib/enterprise/db";
import { randomUUID } from "node:crypto";
import { writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execSync } from "node:child_process";

/**
 * POST /api/enterprise/v1/runs
 * Create a new enterprise run. Spawns the worker process to execute the agent.
 */
export async function POST(req: Request) {
  // Rate limit: max 10 run creations per minute per client
  if (!checkRateLimit(`runs:${getClientKey(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // Authentication + RBAC
  const auth = await authenticateRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const perm = requirePermission(auth.user, "run:create");
  if (!perm.ok) {
    return NextResponse.json({ error: perm.error }, { status: perm.status });
  }

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

    // Quota check
    const db = await getEnterpriseDb().catch(() => null);
    if (db) {
      const quotaCheck = await checkQuota(db, body.organizationId ?? "default");
      if (!quotaCheck.allowed) {
        return NextResponse.json({ error: quotaCheck.reason }, { status: 429 });
      }
    }

    const repo = await getRunRepository();
    const runId = randomUUID();
    const now = new Date().toISOString();

    const record: RunRecord = {
      id: runId,
      conversationId: body.conversationId,
      organizationId: body.organizationId ?? "default",
      status: "pending",
      modelProvider: body.modelProvider,
      modelId: body.modelId,
      userInput: body.userInput,
      eventCount: 0,
      createdAt: now,
    };

    await repo.createRun(record);

    // Record usage — fire-and-forget
    if (db) {
      recordUsage(db, {
        organizationId: record.organizationId,
        userId: auth.user.id,
        runId,
        tokensIn: 0,
        tokensOut: 0,
        modelProvider: body.modelProvider,
        modelId: body.modelId,
      }).catch(() => {});
    }

    // Audit log — fire-and-forget
    const auditDb = await getEnterpriseDb().catch(() => null);
    if (auditDb) {
      writeAuditEvent(auditDb, {
        organizationId: record.organizationId,
        action: "run.created",
        resourceType: "run",
        resourceId: runId,
        details: { conversationId: body.conversationId, modelProvider: body.modelProvider, modelId: body.modelId },
        ipAddress: getClientKey(req),
      }).catch(() => {});
    }

    // Spawn worker process asynchronously
    spawnWorker(record, body, repo).catch((err) => {
      console.error("[enterprise-run] worker spawn failed:", err);
      repo.updateRun(runId, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date().toISOString(),
      }).catch(() => {});
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

    const repo = await getRunRepository();
    const runs = await repo.listRuns({ conversationId, organizationId });

    return NextResponse.json({ runs });
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

async function spawnWorker(record: RunRecord, body: RunBody, repo: Awaited<ReturnType<typeof getRunRepository>>): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), "pi-run-"));
  const envelopePath = join(tmpDir, "envelope.json");

  const envelope = {
    protocolVersion: 1,
    runtimeProfile: "agent-harness-v1",
    organizationId: record.organizationId,
    conversationId: body.conversationId,
    runId: record.id,
    attempt: 1,
    workspaceRoot: body.workspaceRoot ?? process.cwd(),
    toolNames: body.toolNames ?? ["read", "bash", "edit", "write"],
    modelProvider: body.modelProvider,
    modelId: body.modelId,
    userInput: body.userInput,
    ...(body.systemPrompt ? { systemPrompt: body.systemPrompt } : {}),
  };

  await writeFile(envelopePath, JSON.stringify(envelope), "utf8");

  await repo.updateRun(record.id, { status: "running", startedAt: new Date().toISOString() });

  const WORKER_MODE = process.env.PI_WORKER_MODE ?? "local";
  const DOCKER_IMAGE = process.env.PI_WORKER_DOCKER_IMAGE ?? "pi-enterprise-worker";

  let child;

  if (WORKER_MODE === "docker") {
    // Run worker in isolated Docker container
    try {
      execSync(`docker image inspect ${DOCKER_IMAGE} --format "{{.Id}}"`, { stdio: "ignore" });
    } catch {
      throw new Error(`Docker image ${DOCKER_IMAGE} not found. Build with: docker build -f Dockerfile.worker -t ${DOCKER_IMAGE} .`);
    }

    const pgUrl = process.env.PI_POSTGRES_URL ?? "";
    const dockerArgs = [
      "run", "--rm",
      "--network", "host", // Share host network for PG access
      "--memory", "512m",
      "--cpus", "1",
      "--read-only",
      "--label", "pi-run-id=" + record.id,
      "--tmpfs", "/tmp:size=100m",
      "-e", `PI_RUN_ENVELOPE_PATH=/tmp/envelope.json`,
      "-e", `PI_RUN_ID=${record.id}`,
      "-e", `PI_POSTGRES_URL=${pgUrl}`,
      "-v", `${envelopePath}:/tmp/envelope.json:ro`,
      DOCKER_IMAGE,
    ];

    child = spawn("docker", dockerArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    // Local process mode (default)
    const workerPath = join(process.cwd(), "packages", "enterprise-worker", "dist", "main.js");
    child = spawn(process.execPath, [workerPath], {
      env: { ...process.env, PI_RUN_ENVELOPE_PATH: envelopePath, PI_RUN_ID: record.id, PI_POSTGRES_URL: process.env.PI_POSTGRES_URL },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  await repo.updateRun(record.id, { workerPid: child.pid ?? undefined });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  child.on("close", async (code) => {
    if (code === 0) {
      try {
        const lines = stdout.trim().split("\n");
        const result = JSON.parse(lines[lines.length - 1] ?? "{}");
        await repo.updateRun(record.id, {
          status: "completed",
          response: result.response ?? stdout,
          completedAt: new Date().toISOString(),
        });
      } catch {
        await repo.updateRun(record.id, {
          status: "completed",
          response: stdout,
          completedAt: new Date().toISOString(),
        });
      }
    } else {
      await repo.updateRun(record.id, {
        status: "failed",
        error: stderr || `Worker exited with code ${code}`,
        completedAt: new Date().toISOString(),
      });
    }
  });

  child.on("error", async (err) => {
    await repo.updateRun(record.id, {
      status: "failed",
      error: err.message,
      completedAt: new Date().toISOString(),
    });
  });
}
