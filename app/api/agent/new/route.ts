import { NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import { isAbsolute, resolve, normalize } from "path";
import { allowFileRoot } from "@/lib/file-access";
import { startRpcSession } from "@/lib/rpc-manager";
import { sanitizeError } from "@/lib/api-errors";

const MAX_CWD_LENGTH = 4096;
const BLOCKED_PATHS = new Set(["/", "/etc", "/var", "/usr", "/bin", "/sbin", "/boot", "/dev", "/proc", "/sys"]);

function validateCwd(cwd: string): string | null {
  if (!cwd || typeof cwd !== "string") return "cwd is required";
  if (cwd.length > MAX_CWD_LENGTH) return "cwd too long";
  const normalized = isAbsolute(cwd) ? normalize(cwd) : resolve(cwd);
  if (!existsSync(normalized)) return "Directory does not exist";
  try {
    if (!statSync(normalized).isDirectory()) return "Path is not a directory";
  } catch {
    return "Cannot stat directory";
  }
  if (BLOCKED_PATHS.has(normalized)) return "Access to system directories is denied";
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd: rawCwd, ...command } = body;

    if (!rawCwd || typeof rawCwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const cwd = isAbsolute(rawCwd) ? normalize(rawCwd) : resolve(rawCwd);
    const cwdError = validateCwd(rawCwd);
    if (cwdError) {
      return NextResponse.json({ error: cwdError }, { status: 400 });
    }

    const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } = command as {
      provider?: string; modelId?: string; toolNames?: string[]; thinkingLevel?: string; [key: string]: unknown;
    };

    const tempKey = `__new__${Date.now()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames);
    allowFileRoot(cwd);

    if (provider && typeof provider === "string" && modelId && typeof modelId === "string") {
      await session.send({ type: "set_model", provider, modelId });
    }
    if (thinkingLevel && typeof thinkingLevel === "string") {
      await session.send({ type: "set_thinking_level", level: thinkingLevel });
    }

    if (promptCommand.type === "ensure_session") {
      return NextResponse.json({ success: true, sessionId: realSessionId, data: null });
    }

    const result = await session.send(promptCommand);
    return NextResponse.json({ success: true, sessionId: realSessionId, data: result });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
