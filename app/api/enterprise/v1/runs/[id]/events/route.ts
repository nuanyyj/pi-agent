import { isEnterpriseEnabled } from "@/lib/enterprise/db";
import { getRun } from "@/lib/enterprise/run-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/enterprise/v1/runs/[id]/events
 * SSE stream of run events. Clients connect and receive real-time updates.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isEnterpriseEnabled()) {
    return new Response("Enterprise mode not enabled", { status: 503 });
  }

  const { id } = await params;
  const run = getRun(id);

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
      sendEvent({
        type: "status",
        status: run.status,
        eventCount: run.events.length,
      });

      // Send all existing events
      for (const event of run.events) {
        sendEvent(event);
      }

      // If run is already terminal, send completion and close
      if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
        sendEvent({
          type: "terminal",
          status: run.status,
          response: run.response,
          error: run.error,
        });
        controller.close();
        return;
      }

      // Poll for new events while run is active
      let lastEventCount = run.events.length;
      const interval = setInterval(() => {
        const currentRun = getRun(id);
        if (!currentRun) {
          sendEvent({ type: "error", message: "Run not found" });
          clearInterval(interval);
          controller.close();
          return;
        }

        // Send new events
        while (lastEventCount < currentRun.events.length) {
          sendEvent(currentRun.events[lastEventCount]);
          lastEventCount++;
        }

        // Check for terminal state
        if (currentRun.status === "completed" || currentRun.status === "failed" || currentRun.status === "cancelled") {
          sendEvent({
            type: "terminal",
            status: currentRun.status,
            response: currentRun.response,
            error: currentRun.error,
          });
          clearInterval(interval);
          controller.close();
        }
      }, 500);

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
