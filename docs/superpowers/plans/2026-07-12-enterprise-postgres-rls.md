# Enterprise PostgreSQL RLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PostgreSQL-enforced organization isolation so a missing application filter cannot expose or mutate another tenant's business rows.

**Architecture:** Separate the schema owner connection from a non-superuser, non-`BYPASSRLS` runtime role. Apply forced RLS to organization-owned business tables and parent-derived policies to entries/events. Every tenant operation runs inside a transaction with `set_config('pi.organization_id', ..., true)`; unscoped runtime access fails closed. Authentication bootstrap tables remain outside tenant RLS because organization identity is not known until the Cookie or OIDC state has been resolved.

**Tech Stack:** PostgreSQL 17 RLS, TypeScript 5.9, `pg`, Next.js API routes, Vitest with a real Docker PostgreSQL instance.

**Status:** Core RLS policies and the transaction-scoped organization helper are implemented. Runtime-role deployment and full API/worker adoption remain pending.

---

### Task 1: Prove RLS behavior with a non-privileged role

**Files:**
- Create: `test/enterprise/rls.test.ts`
- Modify: `packages/enterprise-session-broker/src/db.ts`

- [x] **Step 1: Write the failing integration test**

Create two organizations' sessions/runs using the owner connection. Connect as `pi_enterprise_runtime`; prove that no organization context returns zero rows, `org-a` returns only `org-a`, inserts with `org-b` fail under `org-a`, and child session entries/run events inherit parent ownership.

- [x] **Step 2: Verify RED**

Run with both `PI_POSTGRES_ADMIN_URL` and `PI_POSTGRES_URL`. Expected: FAIL because runtime role, RLS policies, and tenant context helper do not exist.

- [x] **Step 3: Add forced RLS policies**

Enable and force RLS on the execution-path core tables: `enterprise_sessions`, `enterprise_session_entries`, `enterprise_runs`, and `enterprise_run_events`. Direct tables compare `organization_id` with `nullif(current_setting('pi.organization_id', true), '')`. Child tables use an `exists` subquery through their parent row. Serialize bootstrap with a PostgreSQL advisory lock and record the policy migration so concurrent application startup does not recreate policies while business transactions are active. The remaining organization-owned tables and runtime-role grants stay in Tasks 3 and 4.

- [x] **Step 4: Verify GREEN**

Run the focused real-PG RLS test and expect every isolation case to pass.

### Task 2: Add tenant-scoped database execution

**Files:**
- Modify: `packages/enterprise-session-broker/src/db.ts`
- Create: `test/enterprise/tenant-db.test.ts`

- [x] **Step 1: Write failing wrapper tests**

Define `withOrganization(organizationId, fn)` on `EnterpriseDatabase`. Test that it starts a transaction, applies a transaction-local setting with parameter binding, rejects empty IDs, does not leak context to a later pooled request, and rolls back on failure.

- [x] **Step 2: Verify RED**

Expected: type/runtime failure because `withOrganization` does not exist.

- [ ] **Step 3: Split bootstrap/runtime URLs**

The `withOrganization()` wrapper is implemented. Splitting bootstrap/runtime URLs and rejecting privileged production runtime roles remains part of the next batch.

`createEnterpriseDatabase(runtimeUrl, { bootstrapUrl })` runs migrations only via `bootstrapUrl`; production rejects a runtime role that is superuser, `BYPASSRLS`, or owns an RLS table. Tests may explicitly opt into owner mode for migration-only fixtures. `withOrganization()` uses one pooled client and `set_config(..., true)` inside `BEGIN`/`COMMIT`.

### Task 3: Scope control-plane and worker database operations

**Files:**
- Modify: `lib/enterprise/db.ts`
- Modify: `lib/enterprise/run-repo.ts`
- Modify: `packages/enterprise-session-broker/src/broker.ts`
- Modify: `packages/enterprise-worker/src/run-executor.ts`
- Modify: enterprise API routes that query business tables directly

- [ ] **Step 1: Add failing repository/API contract tests**

Prove repositories receive an organization-scoped transaction instead of the unrestricted database. ID-only methods must require an organization ID or run within an already-scoped database handle.

- [ ] **Step 2: Implement scoped execution**

Resolve the authenticated organization first, call `db.withOrganization(organizationId, tx => ...)`, and create broker/run repositories from `tx`. The worker scopes all Conversation, Run, event, quota, and audit operations to the envelope organization. Health and auth tables remain explicitly unscoped.

- [ ] **Step 3: Verify API and worker behavior**

Run existing integration tests plus cross-organization route tests. Expected: no behavior regression and RLS blocks deliberately omitted SQL filters.

### Task 4: Add runtime role deployment configuration

**Files:**
- Create: `docker/postgres/init/001-runtime-role.sh`
- Modify: `compose.enterprise.yml`
- Modify: `.env.enterprise.example`
- Modify: `docs/enterprise/development.md`

- [ ] **Step 1: Configure local runtime credentials**

Initialize `PI_POSTGRES_RUNTIME_USER` and `PI_POSTGRES_RUNTIME_PASSWORD` with a non-superuser role. `PI_POSTGRES_ADMIN_URL` is migration-only; `PI_POSTGRES_URL` uses runtime credentials for Web and workers.

- [ ] **Step 2: Document production invariants**

Document separate secret ownership, no superuser/BYPASSRLS runtime credentials, transaction-scoped organization context, connection-pool behavior, and a deployment verification query.

### Task 5: Verify and publish

- [ ] **Step 1:** Run focused RLS tests against Docker PostgreSQL.
- [ ] **Step 2:** Run `npm run check:enterprise` with runtime and admin URLs.
- [ ] **Step 3:** Build enterprise packages and worker image.
- [ ] **Step 4:** Inspect staged diff, RLS policy SQL, secret scan, and generated `dist`.
- [ ] **Step 5:** Commit `feat(enterprise): enforce PostgreSQL tenant isolation` and push the current branch without staging `app/globals.css`.
