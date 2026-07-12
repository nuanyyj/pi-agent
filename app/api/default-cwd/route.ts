import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { allowFileRoot } from "@/lib/file-access";

export const dynamic = "force-dynamic";

// Simple in-memory rate limiter: max 5 calls per minute
declare global { var __piDefaultCwdHits: number[] | undefined; }
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(): boolean {
  const now = Date.now();
  if (!globalThis.__piDefaultCwdHits) globalThis.__piDefaultCwdHits = [];
  globalThis.__piDefaultCwdHits = globalThis.__piDefaultCwdHits.filter((t) => now - t < RATE_WINDOW_MS);
  if (globalThis.__piDefaultCwdHits.length >= RATE_LIMIT) return false;
  globalThis.__piDefaultCwdHits.push(now);
  return true;
}

// POST /api/default-cwd
// Creates ~/pi-cwd-<YYYYMMDD> if it doesn't exist and returns the path.
export async function POST() {
  if (!checkRateLimit()) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const dir = join(homedir(), `pi-cwd-${date}`);
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
