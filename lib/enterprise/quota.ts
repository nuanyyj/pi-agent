/**
 * Enterprise quota management.
 *
 * Enforces per-organization limits on:
 *   - Runs per day
 *   - Runs per hour
 *   - Concurrent running runs
 *
 * Also tracks usage (tokens in/out) for cost monitoring.
 */

import type { EnterpriseDatabase } from "@pi-web/enterprise-session-broker";

// ── Types ──────────────────────────────────────────────────────────────

export interface QuotaConfig {
  organizationId: string;
  maxRunsPerDay: number;
  maxRunsPerHour: number;
  maxConcurrentRuns: number;
}

export interface UsageRecord {
  organizationId: string;
  userId: string;
  runId: string;
  tokensIn: number;
  tokensOut: number;
  modelProvider: string;
  modelId: string;
}

export interface UsageSummary {
  runsToday: number;
  runsThisHour: number;
  runningNow: number;
  tokensInTotal: number;
  tokensOutTotal: number;
  quota: QuotaConfig;
}

// ── Default quotas ─────────────────────────────────────────────────────

const DEFAULT_QUOTA: Omit<QuotaConfig, "organizationId"> = {
  maxRunsPerDay: 100,
  maxRunsPerHour: 20,
  maxConcurrentRuns: 5,
};

// ── Quota checking ─────────────────────────────────────────────────────

/**
 * Check if an organization can create a new run.
 * Returns `{ allowed: true }` or `{ allowed: false, reason }`.
 */
export async function checkQuota(
  db: EnterpriseDatabase,
  organizationId: string,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  // Get quota config
  const quota = await getQuotaConfig(db, organizationId);

  // Count runs today
  const dayResult = await db.query<{ count: string }>(
    `SELECT count(*) FROM enterprise_runs
     WHERE organization_id = $1 AND created_at > now() - interval '1 day'`,
    [organizationId],
  );
  const runsToday = Number(dayResult.rows[0]?.count ?? 0);
  if (runsToday >= quota.maxRunsPerDay) {
    return { allowed: false, reason: `Daily limit reached (${quota.maxRunsPerDay} runs/day)` };
  }

  // Count runs this hour
  const hourResult = await db.query<{ count: string }>(
    `SELECT count(*) FROM enterprise_runs
     WHERE organization_id = $1 AND created_at > now() - interval '1 hour'`,
    [organizationId],
  );
  const runsThisHour = Number(hourResult.rows[0]?.count ?? 0);
  if (runsThisHour >= quota.maxRunsPerHour) {
    return { allowed: false, reason: `Hourly limit reached (${quota.maxRunsPerHour} runs/hour)` };
  }

  // Count concurrent running
  const concurrentResult = await db.query<{ count: string }>(
    `SELECT count(*) FROM enterprise_runs
     WHERE organization_id = $1 AND status = 'running'`,
    [organizationId],
  );
  const runningNow = Number(concurrentResult.rows[0]?.count ?? 0);
  if (runningNow >= quota.maxConcurrentRuns) {
    return { allowed: false, reason: `Concurrent limit reached (${quota.maxConcurrentRuns} simultaneous runs)` };
  }

  return { allowed: true };
}

// ── Config management ──────────────────────────────────────────────────

export async function getQuotaConfig(
  db: EnterpriseDatabase,
  organizationId: string,
): Promise<QuotaConfig> {
  const result = await db.query(
    `SELECT * FROM enterprise_quotas WHERE organization_id = $1`,
    [organizationId],
  );
  if (result.rows[0]) {
    const row = result.rows[0] as Record<string, unknown>;
    return {
      organizationId,
      maxRunsPerDay: Number(row.max_runs_per_day),
      maxRunsPerHour: Number(row.max_runs_per_hour),
      maxConcurrentRuns: Number(row.max_concurrent_runs),
    };
  }
  return { organizationId, ...DEFAULT_QUOTA };
}

export async function updateQuotaConfig(
  db: EnterpriseDatabase,
  config: Partial<QuotaConfig> & { organizationId: string },
): Promise<QuotaConfig> {
  await db.query(
    `INSERT INTO enterprise_quotas (organization_id, max_runs_per_day, max_runs_per_hour, max_concurrent_runs, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (organization_id) DO UPDATE SET
       max_runs_per_day = COALESCE(EXCLUDED.max_runs_per_day, enterprise_quotas.max_runs_per_day),
       max_runs_per_hour = COALESCE(EXCLUDED.max_runs_per_hour, enterprise_quotas.max_runs_per_hour),
       max_concurrent_runs = COALESCE(EXCLUDED.max_concurrent_runs, enterprise_quotas.max_concurrent_runs),
       updated_at = now()`,
    [
      config.organizationId,
      config.maxRunsPerDay ?? DEFAULT_QUOTA.maxRunsPerDay,
      config.maxRunsPerHour ?? DEFAULT_QUOTA.maxRunsPerHour,
      config.maxConcurrentRuns ?? DEFAULT_QUOTA.maxConcurrentRuns,
    ],
  );
  return getQuotaConfig(db, config.organizationId);
}

// ── Usage tracking ─────────────────────────────────────────────────────

export async function recordUsage(
  db: EnterpriseDatabase,
  usage: UsageRecord,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO enterprise_usage (organization_id, user_id, run_id, tokens_in, tokens_out, model_provider, model_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [usage.organizationId, usage.userId, usage.runId, usage.tokensIn, usage.tokensOut, usage.modelProvider, usage.modelId],
    );
  } catch (err) {
    console.error("[quota] recordUsage failed:", err);
  }
}

export async function getUsageSummary(
  db: EnterpriseDatabase,
  organizationId: string,
): Promise<UsageSummary> {
  const quota = await getQuotaConfig(db, organizationId);

  const dayResult = await db.query<{ count: string }>(
    `SELECT count(*) FROM enterprise_runs WHERE organization_id = $1 AND created_at > now() - interval '1 day'`,
    [organizationId],
  );
  const hourResult = await db.query<{ count: string }>(
    `SELECT count(*) FROM enterprise_runs WHERE organization_id = $1 AND created_at > now() - interval '1 hour'`,
    [organizationId],
  );
  const concurrentResult = await db.query<{ count: string }>(
    `SELECT count(*) FROM enterprise_runs WHERE organization_id = $1 AND status = 'running'`,
    [organizationId],
  );
  const tokensResult = await db.query<{ tin: string; tout: string }>(
    `SELECT coalesce(sum(tokens_in), 0) as tin, coalesce(sum(tokens_out), 0) as tout
     FROM enterprise_usage WHERE organization_id = $1 AND recorded_at > now() - interval '30 days'`,
    [organizationId],
  );

  return {
    runsToday: Number(dayResult.rows[0]?.count ?? 0),
    runsThisHour: Number(hourResult.rows[0]?.count ?? 0),
    runningNow: Number(concurrentResult.rows[0]?.count ?? 0),
    tokensInTotal: Number(tokensResult.rows[0]?.tin ?? 0),
    tokensOutTotal: Number(tokensResult.rows[0]?.tout ?? 0),
    quota,
  };
}
