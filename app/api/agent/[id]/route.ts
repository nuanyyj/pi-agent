import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { sanitizeError } from "@/lib/api-errors";

// Allowed command types. Anything else is rejected before hitting the agent.
const ALLOWED_COMMAND_TYPES = new Set([
  "prompt",
  "ensure_session",
  "get_state",
  "set_model",
  "set_thinking_level",
  "set_active_tools",
  "compact",
  "abort",
  "steer",
  "follow_up",
  "navigate_tree",
  "move_to",
  "set_name",
  "get_last_assistant_text",
  "reload_extensions",
  "get_slash_commands",
  "get_queued_messages",
]);

const MAX_ID_LENGTH = 256;
const MAX_BODY_SIZE = 1024 * 1024; // 1MB

function validateId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH;
}

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!validateId(id)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  try {
    const body = await req.json() as { type?: string; [key: string]: unknown };

    if (!body.type || typeof body.type !== "string") {
      return NextResponse.json({ error: "type is required" }, { status: 400 });
    }
    if (!ALLOWED_COMMAND_TYPES.has(body.type)) {
      return NextResponse.json({ error: `Unknown command type: ${body.type}` }, { status: 400 });
    }

    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      return NextResponse.json({ success: true, data: result });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
    const { session } = await startRpcSession(id, filePath, cwd);
    const result = await session.send(body);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!validateId(id)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }
    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
