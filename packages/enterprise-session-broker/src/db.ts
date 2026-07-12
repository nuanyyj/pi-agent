import { Client, Pool } from "pg";

export interface EnterpriseQueryResult<T> {
  rows: T[];
}

export interface EnterpriseTransaction {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<EnterpriseQueryResult<T>>;
}

export interface EnterpriseDatabase {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<EnterpriseQueryResult<T>>;
  transaction<T>(fn: (tx: EnterpriseTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function wrapClientQuery(client: Client | import("pg").PoolClient) {
  return async function query<T>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<EnterpriseQueryResult<T>> {
    const res = params
      ? await client.query(sql, [...params])
      : await client.query(sql);
    return { rows: res.rows as T[] };
  };
}

export async function createEnterpriseDatabase(
  connectionString: string,
): Promise<EnterpriseDatabase> {
  const pool = new Pool({ connectionString, max: 10 });
  // Bootstrap schema using a dedicated client
  const bootstrap = new Client({ connectionString });
  await bootstrap.connect();
  await ensureSchema(bootstrap);
  await bootstrap.end();

  return {
    query: async (sql, params) => {
      const client = await pool.connect();
      try {
        const q = wrapClientQuery(client);
        return q(sql, params);
      } finally {
        client.release();
      }
    },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn({ query: wrapClientQuery(client) });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    close: async () => {
      await pool.end();
    },
  };
}

async function ensureSchema(client: Client): Promise<void> {
  await client.query(`
    create table if not exists enterprise_schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  await client.query(`
    create table if not exists enterprise_sessions (
      id text primary key,
      organization_id text not null,
      workspace_root text not null,
      scope jsonb not null default '{}'::jsonb,
      metadata jsonb not null default '{}'::jsonb,
      parent_session_id text null,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      deleted_at timestamptz null,
      version bigint not null default 0,
      active_leaf_id text null
    )
  `);
  await client.query(`
    create table if not exists enterprise_session_entries (
      session_id text not null references enterprise_sessions(id) on delete cascade,
      version bigint not null,
      entry_id text not null,
      parent_id text null,
      entry_type text not null,
      entry jsonb not null,
      recorded_at timestamptz not null,
      primary key (session_id, version),
      unique (session_id, entry_id)
    )
  `);
  await client.query(`
    create index if not exists enterprise_session_entries_type_idx
      on enterprise_session_entries(session_id, entry_type)
  `);
  await client.query(`
    create index if not exists enterprise_session_entries_parent_idx
      on enterprise_session_entries(session_id, parent_id)
  `);
  // Enterprise runs and run events
  await client.query(`
    create table if not exists enterprise_runs (
      id text primary key,
      conversation_id text not null,
      organization_id text not null,
      status text not null default 'pending',
      model_provider text not null,
      model_id text not null,
      user_input text not null,
      response text null,
      error text null,
      worker_pid integer null,
      agent_id text null,
      agent_snapshot jsonb null,
      created_at timestamptz not null default now(),
      started_at timestamptz null,
      completed_at timestamptz null
    )
  `);
  await client.query(`
    alter table enterprise_runs
      add column if not exists agent_id text null,
      add column if not exists agent_snapshot jsonb null
  `);
  await client.query(`
    create index if not exists enterprise_runs_conversation_idx
      on enterprise_runs(conversation_id)
  `);
  await client.query(`
    create index if not exists enterprise_runs_org_idx
      on enterprise_runs(organization_id, created_at desc)
  `);
  await client.query(`
    create table if not exists enterprise_run_events (
      run_id text not null references enterprise_runs(id) on delete cascade,
      seq integer not null,
      event_type text not null,
      event_data jsonb not null,
      recorded_at timestamptz not null default now(),
      primary key (run_id, seq)
    )
  `);
  // Audit log — append-only
  await client.query(`
    create table if not exists enterprise_audit_events (
      id bigserial primary key,
      organization_id text not null,
      actor_id text not null default 'system',
      action text not null,
      resource_type text not null,
      resource_id text not null,
      details jsonb not null default '{}'::jsonb,
      ip_address text null,
      recorded_at timestamptz not null default now()
    )
  `);
  await client.query(`
    create index if not exists enterprise_audit_org_idx
      on enterprise_audit_events(organization_id, recorded_at desc)
  `);
  await client.query(`
    create index if not exists enterprise_audit_resource_idx
      on enterprise_audit_events(resource_type, resource_id)
  `);

  // Quota management tables
  await client.query(`
    create table if not exists enterprise_quotas (
      organization_id text primary key,
      max_runs_per_day integer not null default 100,
      max_runs_per_hour integer not null default 20,
      max_concurrent_runs integer not null default 5,
      updated_at timestamptz not null default now()
    )
  `);
  await client.query(`
    create table if not exists enterprise_usage (
      id bigserial primary key,
      organization_id text not null,
      user_id text not null,
      run_id text not null,
      tokens_in bigint not null default 0,
      tokens_out bigint not null default 0,
      model_provider text not null,
      model_id text not null,
      recorded_at timestamptz not null default now()
    )
  `);
  await client.query(`
    create index if not exists enterprise_usage_org_idx
      on enterprise_usage(organization_id, recorded_at desc)
  `);

  // Agent registry
  await client.query(`
    create table if not exists enterprise_agents (
      id text not null,
      organization_id text not null,
      name text not null,
      description text not null default '',
      system_prompt text not null default '',
      default_model_provider text not null default 'openai',
      default_model_id text not null default 'gpt-4o',
      default_tools jsonb not null default '[]'::jsonb,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (id, organization_id)
    )
  `);
  await client.query(`
    create index if not exists enterprise_agents_org_idx
      on enterprise_agents(organization_id, is_active)
  `);

  // Revocable browser sessions. Only a SHA-256 digest of the opaque cookie is
  // stored so a database read cannot be used directly as an authenticated session.
  await client.query(`
    create table if not exists enterprise_auth_sessions (
      id uuid primary key,
      token_hash text not null unique,
      user_id text not null,
      email text null,
      display_name text null,
      organization_id text not null,
      roles jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null,
      last_seen_at timestamptz not null default now(),
      revoked_at timestamptz null
    )
  `);
  await client.query(`
    create index if not exists enterprise_auth_sessions_user_idx
      on enterprise_auth_sessions(user_id, organization_id, expires_at desc)
  `);
  await client.query(`
    create index if not exists enterprise_auth_sessions_expiry_idx
      on enterprise_auth_sessions(expires_at)
      where revoked_at is null
  `);

  // OIDC Authorization Code + PKCE transactions. State is stored only as a
  // digest and each row is consumed atomically before a token exchange.
  await client.query(`
    create table if not exists enterprise_oidc_login_flows (
      state_hash text primary key,
      code_verifier text not null,
      nonce text not null,
      return_to text not null default '/',
      created_at timestamptz not null default now(),
      expires_at timestamptz not null,
      consumed_at timestamptz null
    )
  `);
  await client.query(`
    create index if not exists enterprise_oidc_login_flows_expiry_idx
      on enterprise_oidc_login_flows(expires_at)
      where consumed_at is null
  `);
}
