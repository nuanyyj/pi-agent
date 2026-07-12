import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getRunRepository, type RunRecord } from "@/lib/enterprise/run-repo";
import { checkRateLimit, getClientKey } from "@/lib/enterprise/rate-limit";
import { authenticateRequest } from "@/lib/enterprise/auth";
import { checkQuota, recordUsage } from "@/lib/enterprise/quota";
import { requirePermission } from "@/lib/enterprise/rbac";
import { writeAuditEvent } from "@/lib/enterprise/audit-log";
import {
  AgentRuntimeError,
  resolveExecutionSnapshot,
  type AgentExecutionSnapshot,
} from "@/lib/enterprise/agent-runtime";
import { resolveOrganizationAccess } from "@/lib/enterprise/request-access";
import {
  resolveEnterpriseWorkspaceRoot,
  WorkspacePolicyError,
} from "@/lib/enterprise/workspace-policy";
import { buildDockerWorkerLaunch } from "@/lib/enterprise/docker-worker";
import { canWorkerFinalizeRun } from "@/lib/enterprise/run-lifecycle";
import { randomUUID } from "node:crypto";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";

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
      agentId?: string;
      modelProvider?: string;
      modelId?: string;
      userInput: string;
      systemPrompt?: string;
      toolNames?: string[];
    };

    if (!body.conversationId || !body.userInput?.trim()) {
      return NextResponse.json(
        { error: "conversationId and userInput are required" },
        { status: 400 },
      );
    }

    const access = resolveOrganizationAccess(auth.user, body.organizationId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const organizationId = access.organizationId;

    const db = await getEnterpriseDb();
    if (!db) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }
    const conversationResult = await db.query<{ workspace_root: string }>(
      `select workspace_root from enterprise_sessions
       where id = $1 and organization_id = $2 and deleted_at is null`,
      [body.conversationId, organizationId],
    );
    const conversation = conversationResult.rows[0];
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const workspaceRoot = await resolveEnterpriseWorkspaceRoot(conversation.workspace_root);

    const execution = await resolveExecutionSnapshot(db, {
      organizationId,
      agentId: body.agentId,
      modelProvider: body.modelProvider,
      modelId: body.modelId,
      toolNames: body.toolNames,
      systemPrompt: body.systemPrompt,
    });

    // Quota check
    const quotaCheck = await checkQuota(db, organizationId);
    if (!quotaCheck.allowed) {
      return NextResponse.json({ error: quotaCheck.reason }, { status: 429 });
    }

    const repo = await getRunRepository();
    const runId = randomUUID();
    const now = new Date().toISOString();

    const record: RunRecord = {
      id: runId,
      conversationId: body.conversationId,
      organizationId,
      status: "pending",
      modelProvider: execution.modelProvider,
      modelId: execution.modelId,
      agentId: execution.agentId,
      agentName: execution.agentName,
      userInput: body.userInput.trim(),
      eventCount: 0,
      createdAt: now,
    };

    await repo.createRun(record, execution);

    // Record usage — fire-and-forget
    recordUsage(db, {
      organizationId: record.organizationId,
      userId: auth.user.id,
      runId,
      tokensIn: 0,
      tokensOut: 0,
      modelProvider: execution.modelProvider,
      modelId: execution.modelId,
    }).catch(() => {});

    // Audit log — fire-and-forget
    writeAuditEvent(db, {
      organizationId: record.organizationId,
      actorId: auth.user.id,
      action: "run.created",
      resourceType: "run",
      resourceId: runId,
      details: {
        conversationId: body.conversationId,
        agentId: execution.agentId,
        agentName: execution.agentName,
        modelProvider: execution.modelProvider,
        modelId: execution.modelId,
      },
      ipAddress: getClientKey(req),
    }).catch(() => {});

    // Spawn worker process asynchronously
    spawnWorker(record, {
      conversationId: body.conversationId,
      workspaceRoot,
      userInput: record.userInput,
      execution,
    }, repo).catch((err) => {
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
      agentId: record.agentId,
      agentName: record.agentName,
      createdAt: record.createdAt,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof AgentRuntimeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof WorkspacePolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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

  const auth = await authenticateRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const perm = requirePermission(auth.user, "run:read");
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });

  try {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversationId") ?? undefined;
    const access = resolveOrganizationAccess(auth.user, url.searchParams.get("organizationId"));
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const organizationId = access.organizationId;

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
  workspaceRoot: string;
  userInput: string;
  execution: AgentExecutionSnapshot;
}

async function spawnWorker(record: RunRecord, body: RunBody, repo: Awaited<ReturnType<typeof getRunRepository>>): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), "pi-run-"));
  const envelopePath = join(tmpDir, "envelope.json");

  const workerMode = process.env.PI_WORKER_MODE ?? "local";
  const dockerImage = process.env.PI_WORKER_DOCKER_IMAGE ?? "pi-enterprise-worker";
  const dockerLaunch = workerMode === "docker"
    ? buildDockerWorkerLaunch({
        image: dockerImage,
        runId: record.id,
        envelopePath,
        workspaceRoot: body.workspaceRoot,
        postgresUrl: process.env.PI_POSTGRES_URL ?? "",
        providerEnvironment: process.env,
      })
    : null;

  const envelope = {
    protocolVersion: 1,
    runtimeProfile: "agent-harness-v1",
    organizationId: record.organizationId,
    conversationId: body.conversationId,
    runId: record.id,
    attempt: 1,
    workspaceRoot: dockerLaunch?.envelopeWorkspaceRoot ?? body.workspaceRoot,
    toolNames: body.execution.toolNames,
    modelProvider: body.execution.modelProvider,
    modelId: body.execution.modelId,
    userInput: body.userInput,
    ...(body.execution.systemPrompt ? { systemPrompt: body.execution.systemPrompt } : {}),
  };

  await writeFile(envelopePath, JSON.stringify(envelope), "utf8");

  await repo.updateRun(record.id, { status: "running", startedAt: new Date().toISOString() });

  let child;

  if (dockerLaunch) {
    // Run worker in isolated Docker container
    try {
      execFileSync("docker", ["image", "inspect", dockerImage, "--format", "{{.Id}}"], { stdio: "ignore" });
    } catch {
      throw new Error(`Docker image ${dockerImage} not found. Build with: docker build -f Dockerfile.worker -t ${dockerImage} .`);
    }

    child = spawn("docker", dockerLaunch.args, {
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
  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  };

  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  child.on("close", async (code) => {
    const current = await repo.getRun(record.id);
    if (!current || !canWorkerFinalizeRun(current.status)) {
      await cleanup();
      return;
    }
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
    await cleanup();
  });

  child.on("error", async (err) => {
    const current = await repo.getRun(record.id);
    if (current && canWorkerFinalizeRun(current.status)) {
      await repo.updateRun(record.id, {
        status: "failed",
        error: err.message,
        completedAt: new Date().toISOString(),
      });
    }
    await cleanup();
  });
}
