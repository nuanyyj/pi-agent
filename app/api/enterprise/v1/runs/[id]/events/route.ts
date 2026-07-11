import { getEnterpriseDb, isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getRunRepository } from "@/lib/enterprise/run-repo";
import { Client } from "pg";

export const dynamic = "force-dynamic";

// Limit concurrent SSE connections per run
const MAX_SSE_CONNECTIONS = 10;
declare global { var __piEnterpriseSseCount: Map<string, number> | undefined; }
function getSseCount(): Map<string, number> {
  if (!globalThis.__piEnterpriseSseCount) globalThis.__piEnterpriseSseCount = new Map();
  return globalThis.__piEnterpriseSseCount;
}

/**
 * GET /api/enterprise/v1/runs/[id]/events
 * SSE stream of run events. Uses PG LISTEN/NOTIFY for real-time,
 * falls back to 1s polling if LISTEN is unavailable.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isEnterpriseEnabled()) {
    return new Response("Enterprise mode not enabled", { status: 503 });
  }

  const { id } = await params;

  // SSE connection limit
  const counts = getSseCount();
  const currentCount = counts.get(id) ?? 0;
  if (currentCount >= MAX_SSE_CONNECTIONS) {
    return new Response("Too many connections", { status: 429 });
  }
  counts.set(id, currentCount + 1);

  const repo = await getRunRepository();
  const run = await repo.getRun(id);

  if (!run) {
    counts.set(id, (counts.get(id) ?? 1) - 1);
    if ((counts.get(id) ?? 0) <= 0) counts.delete(id);
    return new Response("Run not found", { status: 404 });
  }

  // If run is already terminal, send final event immediately
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const data = JSON.stringify({
          type: "terminal",
          status: run.status,
          response: run.response,
          error: run.error,
        });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        controller.close();
        counts.set(id, (counts.get(id) ?? 1) - 1);
        if ((counts.get(id) ?? 0) <= 0) counts.delete(id);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Try PG LISTEN for real-time, fall back to polling
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let lastSeq = 0;
      let closed = false;
      let listenClient: Client | null = null;
      let pollInterval: ReturnType<typeof setInterval> | null = null;

      const sendEvent = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { closed = true; }
      };

      const cleanup = () => {
        closed = true;
        if (listenClient) {
          listenClient.query("UNLISTEN enterprise_run_events").catch(() => {});
          listenClient.end().catch(() => {});
          listenClient = null;
        }
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        counts.set(id, (counts.get(id) ?? 1) - 1);
        if ((counts.get(id) ?? 0) <= 0) counts.delete(id);
        try { controller.close(); } catch { /* already closed */ }
      };

      const checkTerminal = async () => {
        const current = await repo.getRun(id);
        if (!current || current.status === "completed" || current.status === "failed" || current.status === "cancelled") {
          sendEvent({
            type: "terminal",
            status: current?.status ?? "unknown",
            response: current?.response,
            error: current?.error,
          });
          cleanup();
          return true;
        }
        return false;
      };

      const fetchAndSend = async () => {
        try {
          const events = await repo.getRunEvents(id, lastSeq);
          for (const event of events) {
            sendEvent(event);
            lastSeq = event.seq;
          }
          if (events.length > 0) await checkTerminal();
        } catch {
          sendEvent({ type: "error", message: "Fetch failed" });
        }
      };

      // Try LISTEN/NOTIFY
      let useListen = false;
      try {
        const pgUrl = process.env.PI_POSTGRES_URL;
        if (pgUrl) {
          listenClient = new Client({ connectionString: pgUrl });
          await listenClient.connect();
          await listenClient.query("LISTEN enterprise_run_events");

          listenClient.on("notification", (msg) => {
            if (closed) return;
            const [notifRunId] = (msg.payload ?? ":").split(":");
            if (notifRunId === id) fetchAndSend();
          });

          listenClient.on("error", () => {
            if (!pollInterval && !closed) {
              pollInterval = setInterval(fetchAndSend, 1000);
            }
          });

          useListen = true;
        }
      } catch {
        // LISTEN not available — will use polling
      }

      // Always poll as safety net (slower if LISTEN active)
      pollInterval = setInterval(fetchAndSend, useListen ? 5000 : 1000);

      // Initial fetch
      await fetchAndSend();

      // Cleanup on disconnect
      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
