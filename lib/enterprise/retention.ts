/**
 * Data retention policy for enterprise tables.
 *
 * Run periodically (e.g., daily cron) to clean up old data.
 * Usage: npx tsx lib/enterprise/retention.ts [--dry-run]
 *
 * Configuration via env:
 *   PI_RETENTION_RUN_DAYS=30       — delete runs older than N days
 *   PI_RETENTION_AUDIT_DAYS=90     — delete audit events older than N days
 *   PI_RETENTION_EVENT_DAYS=30     — delete run events older than N days
 */

import { Pool } from "pg";

const PG_URL = process.env.PI_POSTGRES_URL ?? "";
const RUN_DAYS = Number(process.env.PI_RETENTION_RUN_DAYS ?? "30");
const AUDIT_DAYS = Number(process.env.PI_RETENTION_AUDIT_DAYS ?? "90");
const EVENT_DAYS = Number(process.env.PI_RETENTION_EVENT_DAYS ?? "30");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (!PG_URL) {
    console.error("PI_POSTGRES_URL not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: PG_URL });

  try {
    console.log(`Data retention policy${DRY_RUN ? " (DRY RUN)" : ""}`);
    console.log(`  Runs:       older than ${RUN_DAYS} days`);
    console.log(`  Events:     older than ${EVENT_DAYS} days`);
    console.log(`  Audit:      older than ${AUDIT_DAYS} days`);
    console.log();

    // 1. Delete old run events (cascaded from runs, but also clean orphans)
    const eventsQuery = `
      DELETE FROM enterprise_run_events
      WHERE run_id IN (
        SELECT id FROM enterprise_runs
        WHERE completed_at < now() - interval '${EVENT_DAYS} days'
          AND status IN ('completed', 'failed', 'cancelled')
      )
    `;
    if (DRY_RUN) {
      const count = await pool.query(`
        SELECT count(*) FROM enterprise_run_events
        WHERE run_id IN (
          SELECT id FROM enterprise_runs
          WHERE completed_at < now() - interval '${EVENT_DAYS} days'
            AND status IN ('completed', 'failed', 'cancelled')
        )
      `);
      console.log(`  [dry-run] Would delete ${count.rows[0].count} run events`);
    } else {
      const result = await pool.query(eventsQuery);
      console.log(`  Deleted ${result.rowCount} run events`);
    }

    // 2. Delete old runs (cascades to events via FK)
    const runsQuery = `
      DELETE FROM enterprise_runs
      WHERE completed_at < now() - interval '${RUN_DAYS} days'
        AND status IN ('completed', 'failed', 'cancelled')
    `;
    if (DRY_RUN) {
      const count = await pool.query(`
        SELECT count(*) FROM enterprise_runs
        WHERE completed_at < now() - interval '${RUN_DAYS} days'
          AND status IN ('completed', 'failed', 'cancelled')
      `);
      console.log(`  [dry-run] Would delete ${count.rows[0].count} runs`);
    } else {
      const result = await pool.query(runsQuery);
      console.log(`  Deleted ${result.rowCount} runs`);
    }

    // 3. Delete old soft-deleted sessions
    const sessionsQuery = `
      DELETE FROM enterprise_sessions
      WHERE deleted_at IS NOT NULL
        AND deleted_at < now() - interval '${RUN_DAYS} days'
    `;
    if (DRY_RUN) {
      const count = await pool.query(`
        SELECT count(*) FROM enterprise_sessions
        WHERE deleted_at IS NOT NULL
          AND deleted_at < now() - interval '${RUN_DAYS} days'
      `);
      console.log(`  [dry-run] Would delete ${count.rows[0].count} deleted sessions`);
    } else {
      const result = await pool.query(sessionsQuery);
      console.log(`  Deleted ${result.rowCount} deleted sessions`);
    }

    // 4. Delete old audit events
    const auditQuery = `
      DELETE FROM enterprise_audit_events
      WHERE recorded_at < now() - interval '${AUDIT_DAYS} days'
    `;
    if (DRY_RUN) {
      const count = await pool.query(`
        SELECT count(*) FROM enterprise_audit_events
        WHERE recorded_at < now() - interval '${AUDIT_DAYS} days'
      `);
      console.log(`  [dry-run] Would delete ${count.rows[0].count} audit events`);
    } else {
      const result = await pool.query(auditQuery);
      console.log(`  Deleted ${result.rowCount} audit events`);
    }

    // 5. Report current table sizes
    console.log("\nCurrent table sizes:");
    const tables = [
      "enterprise_sessions",
      "enterprise_session_entries",
      "enterprise_runs",
      "enterprise_run_events",
      "enterprise_audit_events",
    ];
    for (const table of tables) {
      const size = await pool.query(`SELECT count(*) FROM ${table}`);
      console.log(`  ${table}: ${size.rows[0].count} rows`);
    }

    console.log("\nDone.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Retention policy failed:", err);
  process.exit(1);
});
