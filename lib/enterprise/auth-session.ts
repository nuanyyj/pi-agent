import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { EnterpriseDatabase } from "@pi-web/enterprise-session-broker";

const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const MIN_SESSION_TTL_SECONDS = 5 * 60;
const MAX_SESSION_TTL_SECONDS = 24 * 60 * 60;

export interface EnterpriseAuthSessionUser {
  id: string;
  email?: string;
  name?: string;
  organizationId: string;
  roles: string[];
}

export interface CreateAuthSessionOptions {
  ttlSeconds?: number;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function resolveTtlSeconds(value: number | undefined): number {
  const ttl = value ?? DEFAULT_SESSION_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < MIN_SESSION_TTL_SECONDS || ttl > MAX_SESSION_TTL_SECONDS) {
    throw new RangeError(
      `Session TTL must be an integer between ${MIN_SESSION_TTL_SECONDS} and ${MAX_SESSION_TTL_SECONDS} seconds`,
    );
  }
  return ttl;
}

export async function createAuthSession(
  db: EnterpriseDatabase,
  user: EnterpriseAuthSessionUser,
  options: CreateAuthSessionOptions = {},
): Promise<{ token: string; expiresAt: string }> {
  if (!user.id || !user.organizationId) {
    throw new Error("Authenticated user and organization are required");
  }

  const ttlSeconds = resolveTtlSeconds(options.ttlSeconds);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  await db.query(
    `insert into enterprise_auth_sessions
       (id, token_hash, user_id, email, display_name, organization_id, roles, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
    [
      randomUUID(),
      hashToken(token),
      user.id,
      user.email ?? null,
      user.name ?? null,
      user.organizationId,
      JSON.stringify(user.roles),
      expiresAt,
    ],
  );

  return { token, expiresAt };
}

export async function findAuthSession(
  db: EnterpriseDatabase,
  token: string,
): Promise<EnterpriseAuthSessionUser | null> {
  if (!token) return null;

  const result = await db.query<{
    user_id: string;
    email: string | null;
    display_name: string | null;
    organization_id: string;
    roles: unknown;
  }>(
    `select user_id, email, display_name, organization_id, roles
     from enterprise_auth_sessions
     where token_hash = $1
       and revoked_at is null
       and expires_at > now()`,
    [hashToken(token)],
  );

  const row = result.rows[0];
  if (!row) return null;
  const roles = Array.isArray(row.roles)
    ? row.roles.filter((role): role is string => typeof role === "string")
    : [];

  return {
    id: row.user_id,
    ...(row.email ? { email: row.email } : {}),
    ...(row.display_name ? { name: row.display_name } : {}),
    organizationId: row.organization_id,
    roles,
  };
}

export async function revokeAuthSession(
  db: EnterpriseDatabase,
  token: string,
): Promise<void> {
  if (!token) return;
  await db.query(
    `update enterprise_auth_sessions
     set revoked_at = coalesce(revoked_at, now())
     where token_hash = $1`,
    [hashToken(token)],
  );
}

export async function revokeAuthSessionsForUser(
  db: Pick<EnterpriseDatabase, "query">,
  userId: string,
  organizationId: string,
): Promise<void> {
  if (!userId || !organizationId) return;
  await db.query(
    `update enterprise_auth_sessions
     set revoked_at = coalesce(revoked_at, now())
     where user_id = $1
       and organization_id = $2
       and revoked_at is null`,
    [userId, organizationId],
  );
}
