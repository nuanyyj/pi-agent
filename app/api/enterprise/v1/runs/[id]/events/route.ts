import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getRunRepository } from "@/lib/enterprise/run-repo";

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
 * SSE stream of run events. Reads from PG with 1s polling.
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

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (text: string) => {
        try { controller.enqueue(encoder.encode(text)); } catch { /* closed */ }
      };
      const sendEvent = (data: unknown) => {
        send(`data: ${JSON.stringify(data)}\n\n`);
      };

      // SSE retry directive
      send("retry: 3000\n\n");

      // Send current status
      sendEvent({ type: "status", status: run.status, eventCount: run.eventCount });

      // Poll for events and status changes
      let lastSeq = 0;
      const poll = async () => {
        try {
          const events = await repo.getRunEvents(id, lastSeq);
          for (const event of events) {
            sendEvent(event);
            lastSeq = event.seq;
          }

          const current = await repo.getRun(id);
          if (!current || current.status === "completed" || current.status === "failed" || current.status === "cancelled") {
            sendEvent({
              type: "terminal",
              status: current?.status ?? "unknown",
              response: current?.response,
              error: current?.error,
            });
            cleanup();
            controller.close();
          }
        } catch {
          sendEvent({ type: "error", message: "Poll failed" });
        }
      };

      poll();
      const interval = setInterval(poll, 1000);

      const cleanup = () => {
        counts.set(id, (counts.get(id) ?? 1) - 1);
        if ((counts.get(id) ?? 0) <= 0) counts.delete(id);
        clearInterval(interval);
      };

      req.signal?.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      });
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
