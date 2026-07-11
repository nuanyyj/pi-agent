# Phase 0B: Versioned Session Broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PostgreSQL-backed enterprise session broker package that implements atomic versioned session mutations, repo/storage adapters, and restart/conflict integration tests without JSONL enterprise persistence.

**Architecture:** Add one new workspace package for the broker and adapters. Use plain SQL migrations plus a tiny Node/TypeScript database helper so the broker owns all compare-and-set mutations in one transaction. Keep `AgentHarness` integration behind a `BrokeredSessionStorage` proxy so the worker/runtime code does not know about database details.

**Tech Stack:** TypeScript 5.9, Node.js 22, PostgreSQL 17, npm workspaces, Vitest, `pg` for database access, `@earendil-works/pi-agent-core` session contracts, `AgentHarness`.

---

### Task 1: Add the enterprise session broker workspace package

**Files:**
- Create: `packages/enterprise-session-broker/package.json`
- Create: `packages/enterprise-session-broker/tsconfig.json`
- Create: `packages/enterprise-session-broker/src/index.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write the failing package smoke test**

```ts
import { describe, expect, it } from "vitest";
import { ENTERPRISE_SESSION_BROKER_KIND } from "../src/index";

describe("enterprise session broker package", () => {
  it("exports the package kind", () => {
    expect(ENTERPRISE_SESSION_BROKER_KIND).toBe("postgres-session-broker");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/enterprise-session-broker/test/package-smoke.test.ts -v`
Expected: FAIL because the package and export do not exist yet.

- [ ] **Step 3: Add the workspace package manifest and public entrypoint**

```json
{
  "name": "@pi-web/enterprise-session-broker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@earendil-works/pi-agent-core": "0.80.6",
    "pg": "^8.13.0"
  }
}
```

```ts
export const ENTERPRISE_SESSION_BROKER_KIND = "postgres-session-broker" as const;
export * from "./types.js";
export * from "./schema.js";
export * from "./db.js";
export * from "./broker.js";
export * from "./storage.js";
export * from "./repo.js";
export * from "./proxy.js";
```

- [ ] **Step 4: Run the package test again**

Run: `npx vitest run packages/enterprise-session-broker/test/package-smoke.test.ts -v`
Expected: PASS after the package is wired into the workspace.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json packages/enterprise-session-broker
git commit -m "feat(enterprise): add session broker package scaffold"
```

### Task 2: Add database connection and migration bootstrap

**Files:**
- Create: `packages/enterprise-session-broker/src/db.ts`
- Create: `packages/enterprise-session-broker/src/schema.ts`
- Create: `packages/enterprise-session-broker/migrations/0001_init.sql`
- Create: `packages/enterprise-session-broker/test/migration-bootstrap.test.ts`
- Modify: `compose.enterprise.yml`
- Modify: `.env.enterprise.example`
- Modify: `docs/enterprise/development.md`

- [ ] **Step 1: Write the failing migration bootstrap test**

```ts
import { describe, expect, it } from "vitest";
import { createEnterpriseDatabase } from "../src/db";

describe("createEnterpriseDatabase", () => {
  it("connects and creates the schema tables", async () => {
    const db = await createEnterpriseDatabase(process.env.PI_POSTGRES_URL!);
    try {
      const rows = await db.query<{ table_name: string }>(
        `select table_name
         from information_schema.tables
         where table_schema = 'public'
           and table_name in ('enterprise_schema_migrations', 'enterprise_sessions', 'enterprise_session_entries')
         order by table_name`,
      );
      expect(rows.map((row) => row.table_name)).toEqual([
        "enterprise_schema_migrations",
        "enterprise_session_entries",
        "enterprise_sessions",
      ]);
    } finally {
      await db.close();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `PI_POSTGRES_URL=postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise npx vitest run packages/enterprise-session-broker/test/migration-bootstrap.test.ts -v`
Expected: FAIL because the helper and migrations do not exist yet.

- [ ] **Step 3: Implement a tiny PostgreSQL helper and migration runner**

```ts
import { Client } from "pg";

export interface EnterpriseDatabase {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (tx: EnterpriseTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface EnterpriseTransaction {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export async function createEnterpriseDatabase(connectionString: string): Promise<EnterpriseDatabase> {
  const client = new Client({ connectionString });
  await client.connect();
  await runMigrations(client);
  return {
    query: (sql, params) => client.query(sql, params),
    transaction: async (fn) => {
      await client.query("begin");
      try {
        const result = await fn({
          query: (sql, params) => client.query(sql, params),
        });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    },
    close: async () => {
      await client.end();
    },
  };
}

async function runMigrations(client: Client): Promise<void> {
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
      active_leaf_entry_id text null
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
  await client.query(`create index if not exists enterprise_session_entries_type_idx on enterprise_session_entries(session_id, entry_type)`);
  await client.query(`create index if not exists enterprise_session_entries_parent_idx on enterprise_session_entries(session_id, parent_id)`);
}
```

- [ ] **Step 4: Run the test again**

Run: `PI_POSTGRES_URL=postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise npx vitest run packages/enterprise-session-broker/test/migration-bootstrap.test.ts -v`
Expected: PASS and the three tables exist.

- [ ] **Step 5: Commit**

```bash
git add compose.enterprise.yml .env.enterprise.example docs/enterprise/development.md packages/enterprise-session-broker
git commit -m "feat(enterprise): add session broker migrations"
```

### Task 3: Implement typed session mapping and read operations

**Files:**
- Create: `packages/enterprise-session-broker/src/types.ts`
- Create: `packages/enterprise-session-broker/src/broker.ts`
- Create: `packages/enterprise-session-broker/test/broker-read.test.ts`

- [ ] **Step 1: Write the failing read-operations test**

```ts
import { describe, expect, it } from "vitest";
import { createEnterpriseDatabase } from "../src/db";
import { createSessionBroker } from "../src/broker";

describe("session broker reads", () => {
  it("creates, opens, and walks session entries", async () => {
    const db = await createEnterpriseDatabase(process.env.PI_POSTGRES_URL!);
    try {
      const broker = createSessionBroker(db);
      const created = await broker.createSession({
        organizationId: "org-1",
        workspaceRoot: "/workspace",
        sessionId: "session-1",
      });
      expect(created.metadata.id).toBe("session-1");
      expect(await broker.openSession(created.metadata)).toMatchObject({ metadata: created.metadata });
    } finally {
      await db.close();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `PI_POSTGRES_URL=postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise npx vitest run packages/enterprise-session-broker/test/broker-read.test.ts -v`
Expected: FAIL because the broker object and typed mapping do not exist yet.

- [ ] **Step 3: Implement the broker types and read-path methods**

```ts
export interface EnterpriseSessionMetadata {
  id: string;
  createdAt: string;
  organizationId: string;
  workspaceRoot: string;
  parentSessionId?: string;
  scope?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface BrokerSessionSnapshot {
  metadata: EnterpriseSessionMetadata;
  version: number;
  activeLeafId: string | null;
  entries: SessionTreeEntry[];
}

export type BrokerConflict = {
  ok: false;
  currentVersion: number;
  currentLeafId: string | null;
};
```

```ts
import type { EnterpriseDatabase } from "./db";

export function createSessionBroker(db: EnterpriseDatabase) {
  return {
    async createSession(input) { /* insert session row and return snapshot */ },
    async openSession(metadata) { /* load one session snapshot */ },
    async listSessions(query) { /* list by organization/workspace root */ },
    async getEntry(sessionId, entryId) { /* load one entry */ },
    async getEntries(sessionId) { /* load ordered entries */ },
    async getPathToRoot(sessionId, leafId) { /* walk parents */ },
    async getLabel(sessionId, entryId) { /* latest label */ },
  };
}
```

- [ ] **Step 4: Run the test again**

Run: `PI_POSTGRES_URL=postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise npx vitest run packages/enterprise-session-broker/test/broker-read.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/enterprise-session-broker
git commit -m "feat(enterprise): add session broker read path"
```

### Task 4: Implement atomic append-and-advance and move-leaf

**Files:**
- Modify: `packages/enterprise-session-broker/src/broker.ts`
- Create: `packages/enterprise-session-broker/test/broker-conflict.test.ts`

- [ ] **Step 1: Write the failing conflict test**

```ts
import { describe, expect, it } from "vitest";
import { createEnterpriseDatabase } from "../src/db";
import { createSessionBroker } from "../src/broker";

describe("session broker conflicts", () => {
  it("rejects stale appendAndAdvance writes without partial persistence", async () => {
    const db = await createEnterpriseDatabase(process.env.PI_POSTGRES_URL!);
    try {
      const broker = createSessionBroker(db);
      const created = await broker.createSession({ organizationId: "org-1", workspaceRoot: "/workspace", sessionId: "session-1" });
      const ok = await broker.appendAndAdvance({
        sessionId: created.metadata.id,
        expectedVersion: 0,
        entry: {
          type: "message",
          id: "entry-1",
          parentId: null,
          timestamp: "2026-01-01T00:00:00.000Z",
          message: { role: "user", content: "one" },
        },
      });
      expect(ok.ok).toBe(true);
      const conflict = await broker.appendAndAdvance({
        sessionId: created.metadata.id,
        expectedVersion: 0,
        entry: {
          type: "message",
          id: "entry-2",
          parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: { role: "user", content: "two" },
        },
      });
      expect(conflict).toMatchObject({ ok: false, currentVersion: 1 });
    } finally {
      await db.close();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `PI_POSTGRES_URL=postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise npx vitest run packages/enterprise-session-broker/test/broker-conflict.test.ts -v`
Expected: FAIL because atomic mutation methods do not exist yet.

- [ ] **Step 3: Implement append-and-advance and move-leaf**

```ts
export interface AppendAndAdvanceInput {
  sessionId: string;
  expectedVersion: number;
  entry: SessionTreeEntry;
}

export interface MoveLeafInput {
  sessionId: string;
  expectedVersion: number;
  targetId: string | null;
}
```

```ts
async appendAndAdvance(input: AppendAndAdvanceInput): Promise<{ ok: true; version: number; entryId: string } | BrokerConflict> {
  return db.transaction(async (tx) => {
    const session = await loadLockedSession(tx, input.sessionId);
    if (session.version !== input.expectedVersion) return { ok: false, currentVersion: session.version, currentLeafId: session.activeLeafEntryId };
    validateParent(session, input.entry);
    const nextVersion = session.version + 1;
    await insertEntry(tx, session.metadata.id, nextVersion, input.entry);
    await updateSession(tx, session.metadata.id, nextVersion, input.entry.id);
    return { ok: true, version: nextVersion, entryId: input.entry.id };
  });
}

async moveLeaf(input: MoveLeafInput): Promise<{ ok: true; version: number; leafId: string | null } | BrokerConflict> {
  return db.transaction(async (tx) => {
    const session = await loadLockedSession(tx, input.sessionId);
    if (session.version !== input.expectedVersion) return { ok: false, currentVersion: session.version, currentLeafId: session.activeLeafEntryId };
    if (input.targetId !== null) await ensureEntryExists(tx, session.metadata.id, input.targetId);
    const nextVersion = session.version + 1;
    const leafEntry = createLeafEntry(session.activeLeafEntryId, input.targetId);
    await insertEntry(tx, session.metadata.id, nextVersion, leafEntry);
    await updateSession(tx, session.metadata.id, nextVersion, input.targetId);
    return { ok: true, version: nextVersion, leafId: input.targetId };
  });
}
```

- [ ] **Step 4: Run the conflict test again**

Run: `PI_POSTGRES_URL=postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise npx vitest run packages/enterprise-session-broker/test/broker-conflict.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/enterprise-session-broker
git commit -m "feat(enterprise): add atomic session mutations"
```

### Task 5: Implement SessionStorage and SessionRepo adapters

**Files:**
- Create: `packages/enterprise-session-broker/src/storage.ts`
- Create: `packages/enterprise-session-broker/src/repo.ts`
- Create: `packages/enterprise-session-broker/test/storage-repo.test.ts`

- [ ] **Step 1: Write the failing adapter test**

```ts
import { describe, expect, it } from "vitest";
import { createEnterpriseDatabase } from "../src/db";
import { createSessionBroker } from "../src/broker";
import { createPostgresSessionRepo } from "../src/repo";

describe("postgres session repo", () => {
  it("implements create/open/list/delete/fork", async () => {
    const db = await createEnterpriseDatabase(process.env.PI_POSTGRES_URL!);
    try {
      const repo = createPostgresSessionRepo(createSessionBroker(db));
      const session = await repo.create({ organizationId: "org-1", workspaceRoot: "/workspace", id: "session-1" });
      const metadata = await session.getMetadata();
      expect(metadata.id).toBe("session-1");
      expect((await repo.list({ organizationId: "org-1" })).map((item) => item.id)).toContain("session-1");
      expect(await repo.open(metadata)).toBeDefined();
    } finally {
      await db.close();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `PI_POSTGRES_URL=postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise npx vitest run packages/enterprise-session-broker/test/storage-repo.test.ts -v`
Expected: FAIL because the adapter factories do not exist yet.

- [ ] **Step 3: Implement the storage and repo wrappers**

```ts
export interface CreateEnterpriseSessionOptions {
  organizationId: string;
  workspaceRoot: string;
  id?: string;
  parentSessionId?: string;
  scope?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export function createPostgresSessionRepo(broker: SessionBroker): SessionRepo<EnterpriseSessionMetadata, CreateEnterpriseSessionOptions, { organizationId: string; workspaceRoot?: string }> {
  return { /* wrap broker with SessionRepo */ };
}
```

```ts
export function createBrokeredSessionStorage(args: {
  broker: SessionBroker;
  metadata: EnterpriseSessionMetadata;
  initialVersion: number;
}): SessionStorage<EnterpriseSessionMetadata> {
  return { /* forward reads and mutations through broker */ };
}
```

- [ ] **Step 4: Run the adapter test again**

Run: `PI_POSTGRES_URL=postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise npx vitest run packages/enterprise-session-broker/test/storage-repo.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/enterprise-session-broker
git commit -m "feat(enterprise): add postgres session adapters"
```

### Task 6: Add restart and stale-version integration tests

**Files:**
- Create: `packages/enterprise-session-broker/test/restart.test.ts`
- Create: `packages/enterprise-session-broker/test/fork-conflict.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/enterprise-foundation.yml`

- [ ] **Step 1: Write the restart regression test**

```ts
import { describe, expect, it } from "vitest";
import { createEnterpriseDatabase } from "../src/db";
import { createSessionBroker } from "../src/broker";

describe("broker restart", () => {
  it("reopens a durable session after a fresh broker instance", async () => {
    const db = await createEnterpriseDatabase(process.env.PI_POSTGRES_URL!);
    try {
      const broker1 = createSessionBroker(db);
      const created = await broker1.createSession({ organizationId: "org-1", workspaceRoot: "/workspace", sessionId: "session-1" });
      await broker1.appendAndAdvance({ sessionId: created.metadata.id, expectedVersion: 0, entry: { /* valid entry */ } });
      const broker2 = createSessionBroker(db);
      const reopened = await broker2.openSession(created.metadata);
      expect(reopened.version).toBe(1);
      expect(reopened.activeLeafId).not.toBeNull();
    } finally {
      await db.close();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `PI_POSTGRES_URL=postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise npx vitest run packages/enterprise-session-broker/test/restart.test.ts -v`
Expected: FAIL because the restart path is not implemented yet.

- [ ] **Step 3: Implement restart-safe snapshot loading and conflict tests**

```ts
async function openSession(metadata: EnterpriseSessionMetadata): Promise<BrokerSessionSnapshot> {
  /* load the row and its entries from PostgreSQL on demand */
}
```

- [ ] **Step 4: Run the restart and fork tests**

Run: `PI_POSTGRES_URL=postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise npx vitest run packages/enterprise-session-broker/test/restart.test.ts packages/enterprise-session-broker/test/fork-conflict.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/enterprise-session-broker package.json .github/workflows/enterprise-foundation.yml
git commit -m "feat(enterprise): add restart-safe session broker tests"
```

### Task 7: Wire the broker into Runtime Stage A

**Files:**
- Modify: `packages/enterprise-worker/src/stage-a-runtime.ts`
- Modify: `packages/enterprise-worker/src/main.ts`
- Modify: `packages/enterprise-worker/src/index.ts`
- Modify: `packages/enterprise-worker/package.json`
- Create: `packages/enterprise-worker/test/brokered-session-storage.test.ts`

- [ ] **Step 1: Write the failing runtime wiring test**

```ts
import { describe, expect, it } from "vitest";
import { createBrokeredSessionStorage } from "../src";

describe("brokered session storage", () => {
  it("tracks expected version and refuses stale writes", async () => {
    expect(createBrokeredSessionStorage).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/enterprise-worker/test/brokered-session-storage.test.ts -v`
Expected: FAIL because the worker does not yet export the brokered storage bridge.

- [ ] **Step 3: Connect the worker to the new brokered storage adapter**

```ts
import { createBrokeredSessionStorage } from "@pi-web/enterprise-session-broker";
import { createStageARuntime } from "./stage-a-runtime";
```

- [ ] **Step 4: Run the runtime wiring test again**

Run: `npx vitest run packages/enterprise-worker/test/brokered-session-storage.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/enterprise-worker packages/enterprise-session-broker
git commit -m "feat(enterprise): wire stage a runtime to brokered storage"
```

### Task 8: Finish with full verification

**Files:**
- Modify: any files needed to fix test or type errors discovered during verification

- [ ] **Step 1: Run the package builds**

Run:

```powershell
npm run build --workspace @pi-web/enterprise-session-broker
npm run build --workspace @pi-web/enterprise-worker
```

Expected: both builds succeed.

- [ ] **Step 2: Run the broker test suite**

Run:

```powershell
npx vitest run packages/enterprise-session-broker/test/*.test.ts
```

Expected: all broker tests pass against PostgreSQL.

- [ ] **Step 3: Run the enterprise gates**

Run:

```powershell
npm run check:runtime-versions
npm run test:enterprise-imports
npm run typecheck
npm run lint
```

Expected: all checks pass or any pre-existing unrelated issue is documented before merge.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(enterprise): complete phase 0b session broker"
```

