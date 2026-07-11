import { describe, expect, it } from "vitest";
import { createEnterpriseDatabase } from "../src/db";

describe("createEnterpriseDatabase", () => {
  it("creates the enterprise session tables", async () => {
    const db = await createEnterpriseDatabase(
      process.env.PI_POSTGRES_URL ??
        "postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise",
    );
    try {
      const rows = await db.query<{ table_name: string }>(
        `select table_name
         from information_schema.tables
         where table_schema = 'public'
           and table_name in (
             'enterprise_schema_migrations',
             'enterprise_sessions',
             'enterprise_session_entries',
             'enterprise_runs',
             'enterprise_run_events',
             'enterprise_audit_events',
             'enterprise_quotas',
             'enterprise_usage'
           )
         order by table_name`,
      );
      expect(rows.rows.map((row) => row.table_name)).toEqual([
        "enterprise_audit_events",
        "enterprise_quotas",
        "enterprise_run_events",
        "enterprise_runs",
        "enterprise_schema_migrations",
        "enterprise_session_entries",
        "enterprise_sessions",
        "enterprise_usage",
      ]);
    } finally {
      await db.close();
    }
  });
});
