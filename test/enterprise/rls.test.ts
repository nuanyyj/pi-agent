import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEnterpriseDatabase, type EnterpriseDatabase } from "../../packages/enterprise-session-broker/src/db";

const ADMIN_URL =
  process.env.PI_POSTGRES_ADMIN_URL
  ?? process.env.PI_POSTGRES_URL
  ?? "postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise";

describe("PostgreSQL organization RLS", () => {
  let adminDb: EnterpriseDatabase;
  let adminClient: Client;
  let runtimeClient: Client;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const runtimeRole = `pi_rls_test_${suffix}`;
  const runtimePassword = randomBytes(24).toString("base64url");
  const orgA = `org-a-${suffix}`;
  const orgB = `org-b-${suffix}`;
  const sessionA = `session-a-${suffix}`;
  const sessionB = `session-b-${suffix}`;
  const runA = `run-a-${suffix}`;
  const runB = `run-b-${suffix}`;

  beforeAll(async () => {
    adminDb = await createEnterpriseDatabase(ADMIN_URL);
    adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    await adminClient.query(
      `create role ${quoteIdentifier(runtimeRole)} login password ${quoteLiteral(runtimePassword)} nosuperuser nobypassrls`,
    );
    await adminClient.query(`grant connect on database ${quoteIdentifier(new URL(ADMIN_URL).pathname.slice(1))} to ${runtimeRole}`);
    await adminClient.query(`grant usage on schema public to ${runtimeRole}`);
    await adminClient.query(`
      grant select, insert, update, delete
      on enterprise_sessions, enterprise_session_entries, enterprise_runs, enterprise_run_events
      to ${quoteIdentifier(runtimeRole)}
    `);

    const now = new Date();
    await adminDb.query(
      `insert into enterprise_sessions
        (id, organization_id, workspace_root, created_at, updated_at)
       values ($1, $2, '/workspace/a', $3, $3),
              ($4, $5, '/workspace/b', $3, $3)`,
      [sessionA, orgA, now, sessionB, orgB],
    );
    await adminDb.query(
      `insert into enterprise_session_entries
        (session_id, version, entry_id, entry_type, entry, recorded_at)
       values ($1, 1, $2, 'message', '{}'::jsonb, $3),
              ($4, 1, $5, 'message', '{}'::jsonb, $3)`,
      [sessionA, `entry-a-${suffix}`, now, sessionB, `entry-b-${suffix}`],
    );

    await adminDb.query(
      `insert into enterprise_runs
        (id, conversation_id, organization_id, status, model_provider, model_id, user_input)
       values ($1, $2, $3, 'pending', 'openai', 'test-model', 'a'),
              ($4, $5, $6, 'pending', 'openai', 'test-model', 'b')`,
      [runA, `conversation-a-${suffix}`, orgA, runB, `conversation-b-${suffix}`, orgB],
    );
    await adminDb.query(
      `insert into enterprise_run_events (run_id, seq, event_type, event_data)
       values ($1, 1, 'run.created', '{}'::jsonb),
              ($2, 1, 'run.created', '{}'::jsonb)`,
      [runA, runB],
    );

    const runtimeUrl = new URL(ADMIN_URL);
    runtimeUrl.username = runtimeRole;
    runtimeUrl.password = runtimePassword;
    runtimeClient = new Client({ connectionString: runtimeUrl.toString() });
    await runtimeClient.connect();
  });

  afterAll(async () => {
    await runtimeClient?.end().catch(() => undefined);
    if (adminDb) {
      await adminDb.query("delete from enterprise_runs where id = any($1::text[])", [[runA, runB]]);
      await adminDb.query("delete from enterprise_sessions where id = any($1::text[])", [[sessionA, sessionB]]);
      await adminDb.close();
    }
    if (adminClient) {
      await adminClient.query(`drop owned by ${quoteIdentifier(runtimeRole)}`);
      await adminClient.query(`drop role if exists ${quoteIdentifier(runtimeRole)}`);
      await adminClient.end();
    }
  });

  it("fails closed without an organization context", async () => {
    const sessions = await runtimeClient.query(
      "select id from enterprise_sessions where id = any($1::text[])",
      [[sessionA, sessionB]],
    );
    const entries = await runtimeClient.query(
      "select session_id from enterprise_session_entries where session_id = any($1::text[])",
      [[sessionA, sessionB]],
    );
    const runs = await runtimeClient.query(
      "select id from enterprise_runs where id = any($1::text[])",
      [[runA, runB]],
    );
    const events = await runtimeClient.query(
      "select run_id from enterprise_run_events where run_id = any($1::text[])",
      [[runA, runB]],
    );
    expect(sessions.rows).toEqual([]);
    expect(entries.rows).toEqual([]);
    expect(runs.rows).toEqual([]);
    expect(events.rows).toEqual([]);
  });

  it("shows only rows for the transaction organization", async () => {
    await runtimeClient.query("begin");
    try {
      await runtimeClient.query("select set_config('pi.organization_id', $1, true)", [orgA]);
      const result = await runtimeClient.query<{ id: string }>(
        "select id from enterprise_runs where id = any($1::text[]) order by id",
        [[runA, runB]],
      );
      expect(result.rows).toEqual([{ id: runA }]);

      const sessions = await runtimeClient.query<{ id: string }>(
        "select id from enterprise_sessions where id = any($1::text[]) order by id",
        [[sessionA, sessionB]],
      );
      expect(sessions.rows).toEqual([{ id: sessionA }]);

      const entries = await runtimeClient.query<{ session_id: string }>(
        "select session_id from enterprise_session_entries where session_id = any($1::text[]) order by session_id",
        [[sessionA, sessionB]],
      );
      expect(entries.rows).toEqual([{ session_id: sessionA }]);

      const events = await runtimeClient.query<{ run_id: string }>(
        "select run_id from enterprise_run_events where run_id = any($1::text[]) order by run_id",
        [[runA, runB]],
      );
      expect(events.rows).toEqual([{ run_id: runA }]);
    } finally {
      await runtimeClient.query("rollback");
    }
  });

  it("rejects a cross-organization insert", async () => {
    await runtimeClient.query("begin");
    try {
      await runtimeClient.query("select set_config('pi.organization_id', $1, true)", [orgA]);
      await expect(runtimeClient.query(
        `insert into enterprise_runs
          (id, conversation_id, organization_id, status, model_provider, model_id, user_input)
         values ($1, $2, $3, 'pending', 'openai', 'test-model', 'blocked')`,
        [`blocked-${suffix}`, `blocked-conversation-${suffix}`, orgB],
      )).rejects.toMatchObject({ code: "42501" });
    } finally {
      await runtimeClient.query("rollback");
    }
  });

  it("rejects a session entry tied to another organization", async () => {
    await runtimeClient.query("begin");
    try {
      await runtimeClient.query("select set_config('pi.organization_id', $1, true)", [orgA]);
      await expect(runtimeClient.query(
        `insert into enterprise_session_entries
          (session_id, version, entry_id, entry_type, entry, recorded_at)
         values ($1, 2, $2, 'message', '{}'::jsonb, now())`,
        [sessionB, `blocked-entry-${suffix}`],
      )).rejects.toMatchObject({ code: "42501" });
    } finally {
      await runtimeClient.query("rollback");
    }
  });

  it("rejects a run event tied to another organization", async () => {
    await runtimeClient.query("begin");
    try {
      await runtimeClient.query("select set_config('pi.organization_id', $1, true)", [orgA]);
      await expect(runtimeClient.query(
        `insert into enterprise_run_events (run_id, seq, event_type, event_data)
         values ($1, 2, 'blocked', '{}'::jsonb)`,
        [runB],
      )).rejects.toMatchObject({ code: "42501" });
    } finally {
      await runtimeClient.query("rollback");
    }
  });
});

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
