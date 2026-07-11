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
}
