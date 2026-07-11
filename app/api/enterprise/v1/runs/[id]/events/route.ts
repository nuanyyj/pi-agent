import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getRunRepository } from "@/lib/enterprise/run-repo";

export const dynamic = "force-dynamic";

/**
 * GET /api/enterprise/v1/runs/[id]/events
 * SSE stream of run events. Reads from PG when available, falls back to memory.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isEnterpriseEnabled()) {
    return new Response("Enterprise mode not enabled", { status: 503 });
  }

  const { id } = await params;
  const repo = await getRunRepository();
  const run = await repo.getRun(id);

  if (!run) {
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
          // Send new events
          const events = await repo.getRunEvents(id, lastSeq);
          for (const event of events) {
            sendEvent(event);
            lastSeq = event.seq;
          }

          // Check terminal state
          const current = await repo.getRun(id);
          if (!current || current.status === "completed" || current.status === "failed" || current.status === "cancelled") {
            sendEvent({
              type: "terminal",
              status: current?.status ?? "unknown",
              response: current?.response,
              error: current?.error,
            });
            clearInterval(interval);
            controller.close();
          }
        } catch (err) {
          sendEvent({ type: "error", message: "Poll failed" });
        }
      };

      // Initial poll
      poll();

      // Continue polling
      const interval = setInterval(poll, 1000);

      // Cleanup on client disconnect
      req.signal?.addEventListener("abort", () => {
        clearInterval(interval);
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
