import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEnterpriseDatabase, type EnterpriseDatabase } from "../../packages/enterprise-session-broker/src/db";
import { createAuthSession, revokeAuthSession } from "../../lib/enterprise/auth-session";
import { authenticateRequest, ENTERPRISE_AUTH_COOKIE } from "../../lib/enterprise/auth";

const PG_URL =
  process.env.PI_POSTGRES_URL ??
  "postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise";

describe("authenticateRequest browser sessions", () => {
  let db: EnterpriseDatabase;
  const userId = `request-user-${randomUUID()}`;
  const user = {
    id: userId,
    email: "request@example.test",
    name: "Request User",
    organizationId: `org-${randomUUID()}`,
    roles: ["viewer"],
  };

  beforeAll(async () => {
    process.env.PI_POSTGRES_URL = PG_URL;
    db = await createEnterpriseDatabase(PG_URL);
  });

  afterAll(async () => {
    if (!db) return;
    await db.query("delete from enterprise_auth_sessions where user_id = $1", [userId]);
    await db.close();
  });

  it("resolves an opaque HttpOnly cookie through PostgreSQL", async () => {
    const created = await createAuthSession(db, user);
    const request = new Request("https://pi.example.test/api/enterprise/v1/runs", {
      headers: { Cookie: `${ENTERPRISE_AUTH_COOKIE}=${encodeURIComponent(created.token)}` },
    });
    await expect(authenticateRequest(request)).resolves.toEqual({ ok: true, user });
  });

  it("rejects a revoked opaque cookie", async () => {
    const created = await createAuthSession(db, user);
    await revokeAuthSession(db, created.token);
    const request = new Request("https://pi.example.test/api/enterprise/v1/runs", {
      headers: { Cookie: `${ENTERPRISE_AUTH_COOKIE}=${created.token}` },
    });
    await expect(authenticateRequest(request)).resolves.toEqual({
      ok: false,
      status: 401,
      error: "Invalid or expired session",
    });
  });
});
