import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEnterpriseDatabase, type EnterpriseDatabase } from "../../packages/enterprise-session-broker/src/db";
import {
  createAuthSession,
  findAuthSession,
  revokeAuthSession,
  revokeAuthSessionsForUser,
} from "../../lib/enterprise/auth-session";

const PG_URL =
  process.env.PI_POSTGRES_URL ??
  "postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise";

describe("enterprise auth sessions", () => {
  let db: EnterpriseDatabase;
  const userId = `auth-user-${randomUUID()}`;
  const user = {
    id: userId,
    email: "auth@example.test",
    name: "Auth User",
    organizationId: `org-${randomUUID()}`,
    roles: ["developer"],
  };

  beforeAll(async () => {
    db = await createEnterpriseDatabase(PG_URL);
  });

  afterAll(async () => {
    if (!db) return;
    await db.query("delete from enterprise_auth_sessions where user_id = $1", [userId]);
    await db.close();
  });

  it("stores only a hash and resolves a valid opaque token", async () => {
    const created = await createAuthSession(db, user, { ttlSeconds: 600 });
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const rows = await db.query<{
      token_hash: string;
      user_id: string;
      organization_id: string;
      roles: string[];
    }>(
      `select token_hash, user_id, organization_id, roles
       from enterprise_auth_sessions
       where user_id = $1
       order by created_at desc
       limit 1`,
      [userId],
    );

    expect(rows.rows[0]).toMatchObject({
      token_hash: createHash("sha256").update(created.token).digest("hex"),
      user_id: user.id,
      organization_id: user.organizationId,
      roles: user.roles,
    });
    expect(JSON.stringify(rows.rows[0])).not.toContain(created.token);
    await expect(findAuthSession(db, created.token)).resolves.toEqual(user);
  });

  it("rejects revoked sessions", async () => {
    const created = await createAuthSession(db, user);
    await revokeAuthSession(db, created.token);
    await expect(findAuthSession(db, created.token)).resolves.toBeNull();
  });

  it("rejects expired sessions", async () => {
    const created = await createAuthSession(db, user, { ttlSeconds: 600 });
    const tokenHash = createHash("sha256").update(created.token).digest("hex");
    await db.query(
      "update enterprise_auth_sessions set expires_at = now() - interval '1 second' where token_hash = $1",
      [tokenHash],
    );
    await expect(findAuthSession(db, created.token)).resolves.toBeNull();
  });

  it("revokes all sessions for one user within one organization", async () => {
    const first = await createAuthSession(db, user);
    const second = await createAuthSession(db, user);
    const otherOrganization = await createAuthSession(db, {
      ...user,
      organizationId: `${user.organizationId}-other`,
    });

    await revokeAuthSessionsForUser(db, user.id, user.organizationId);

    await expect(findAuthSession(db, first.token)).resolves.toBeNull();
    await expect(findAuthSession(db, second.token)).resolves.toBeNull();
    await expect(findAuthSession(db, otherOrganization.token)).resolves.toMatchObject({
      id: user.id,
      organizationId: `${user.organizationId}-other`,
    });
  });
});
