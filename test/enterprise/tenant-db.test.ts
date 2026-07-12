import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEnterpriseDatabase, type EnterpriseDatabase } from "../../packages/enterprise-session-broker/src/db";

const PG_URL =
  process.env.PI_POSTGRES_ADMIN_URL
  ?? process.env.PI_POSTGRES_URL
  ?? "postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise";

describe("EnterpriseDatabase.withOrganization", () => {
  let db: EnterpriseDatabase;

  beforeAll(async () => {
    db = await createEnterpriseDatabase(PG_URL);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("sets organization context only for the transaction", async () => {
    const organizationId = `org-${randomUUID()}`;
    const inside = await db.withOrganization(organizationId, async (tx) => {
      const result = await tx.query<{ organization_id: string }>(
        "select current_setting('pi.organization_id', true) as organization_id",
      );
      return result.rows[0]?.organization_id;
    });
    expect(inside).toBe(organizationId);

    const outside = await db.query<{ organization_id: string }>(
      "select current_setting('pi.organization_id', true) as organization_id",
    );
    expect(outside.rows[0]?.organization_id ?? "").toBe("");
  });

  it("rejects empty organization ids before opening a transaction", async () => {
    await expect(db.withOrganization("  ", async () => undefined))
      .rejects.toThrow("Organization ID is required");
  });

  it("rolls back work when the scoped operation fails", async () => {
    const marker = `rls-marker-${randomUUID()}`;
    await expect(db.withOrganization(`org-${randomUUID()}`, async (tx) => {
      await tx.query("select set_config('pi.test_marker', $1, true)", [marker]);
      throw new Error("scoped failure");
    })).rejects.toThrow("scoped failure");

    const outside = await db.query<{ marker: string }>(
      "select current_setting('pi.test_marker', true) as marker",
    );
    expect(outside.rows[0]?.marker ?? "").toBe("");
  });
});

describe("enterprise schema bootstrap", () => {
  let schemaDb: EnterpriseDatabase;

  beforeAll(async () => {
    schemaDb = await createEnterpriseDatabase(PG_URL);
  });

  afterAll(async () => {
    await schemaDb?.close();
  });

  it("does not recreate an applied tenant policy", async () => {
    const policyName = "enterprise_sessions_organization_isolation";
    const before = await readPolicyOid(schemaDb, policyName);

    const secondDatabase = await createEnterpriseDatabase(PG_URL);
    await secondDatabase.close();

    expect(await readPolicyOid(schemaDb, policyName)).toBe(before);
  });

  it("serializes concurrent schema initialization", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => createEnterpriseDatabase(PG_URL)),
    );

    await Promise.all(
      results
        .filter((result): result is PromiseFulfilledResult<EnterpriseDatabase> => result.status === "fulfilled")
        .map((result) => result.value.close()),
    );

    expect(results.filter((result) => result.status === "rejected")).toEqual([]);
  });
});

async function readPolicyOid(database: EnterpriseDatabase, policyName: string): Promise<string> {
  const result = await database.query<{ oid: string }>(
    "select oid::text as oid from pg_policy where polname = $1",
    [policyName],
  );
  const oid = result.rows[0]?.oid;
  if (!oid) throw new Error(`Policy ${policyName} does not exist`);
  return oid;
}
