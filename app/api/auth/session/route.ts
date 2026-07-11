import { NextResponse } from "next/server";
import { handleLogin, isAuthEnabled, createSession } from "@/lib/auth";

/**
 * POST /api/auth/session — login with password, returns session cookie.
 * When PI_AUTH_TOKEN is not set, always succeeds (local dev mode).
 */
export async function POST(req: Request) {
  try {
    if (!isAuthEnabled()) {
      const token = createSession();
      return NextResponse.json(
        { ok: true, authRequired: false },
        { headers: { "Set-Cookie": `pi-session=${token}; Path=/; HttpOnly; SameSite=Strict` } },
      );
    }

    const body = await req.json() as { password?: string };
    if (!body.password) {
      return NextResponse.json({ error: "password required" }, { status: 400 });
    }

    const result = handleLogin(body.password);
    if (!result.ok) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    return NextResponse.json(
      { ok: true, authRequired: true },
      { headers: { "Set-Cookie": `pi-session=${result.token}; Path=/; HttpOnly; SameSite=Strict` } },
    );
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}

/**
 * GET /api/auth/session — check if auth is required and if current session is valid.
 */
export async function GET(req: Request) {
  const authRequired = isAuthEnabled();
  return NextResponse.json({ authRequired });
}
