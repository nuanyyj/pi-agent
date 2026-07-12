import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — returns auth status (never returns the actual key)
export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  const authStorage = AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const status = registry.getProviderAuthStatus(provider);
  const displayName = registry.getProviderDisplayName(provider);
  const models = registry.getAll().filter((m) => m.provider === provider).length;
  return NextResponse.json({ provider, displayName, configured: status.configured, source: status.source, models });
}

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
export async function POST(req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const { apiKey } = await req.json() as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    const authStorage = AuthStorage.create();
    // Validate key format: must look like a real API key (no control chars, reasonable length)
    const cleanKey = apiKey.trim();
    if (cleanKey.length < 8 || cleanKey.length > 4096 || /[\x00-\x1f\x7f]/.test(cleanKey)) {
      return NextResponse.json({ error: "Invalid API key format" }, { status: 400 });
    }
    authStorage.set(provider, { type: "api_key", key: cleanKey });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key
export async function DELETE(_req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const authStorage = AuthStorage.create();
    authStorage.remove(provider);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: sanitizeError(error) }, { status: 500 });
  }
}


