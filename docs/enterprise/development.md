# Enterprise Phase 0A Development

Phase 0A establishes the engineering foundation for the enterprise agent platform inside `pi-web-main`.

## Requirements

- Node.js `>=22.19.0`
- npm workspaces
- Docker Desktop or Docker Compose v2
- Chromium installed through Playwright for browser regression checks

Install dependencies:

```powershell
npm install --ignore-scripts
```

## Local enterprise services

Start PostgreSQL and MinIO:

```powershell
docker compose --env-file .env.enterprise.example -f compose.enterprise.yml up -d
```

Check service status:

```powershell
docker compose --env-file .env.enterprise.example -f compose.enterprise.yml ps
```

Stop services without deleting persistent volumes:

```powershell
docker compose --env-file .env.enterprise.example -f compose.enterprise.yml down
```

Default local endpoints from `.env.enterprise.example`:

- PostgreSQL: `127.0.0.1:5432`
- MinIO API: `127.0.0.1:19000`
- MinIO console: `127.0.0.1:19001`
- MinIO bucket: `pi-artifacts`

Do not use `.env.enterprise.example` values in production. They are local placeholders only.

## Verification commands

Check pinned Pi runtime versions:

```powershell
npm run check:runtime-versions
```

Build enterprise packages:

```powershell
npm run build:enterprise-packages
```

Run TypeScript checks:

```powershell
npm run typecheck
```

Run unit tests:

```powershell
npm run test:unit
```

Run repository-level enterprise tests:

```powershell
node --test test/enterprise/*.test.mjs
```

Run import-boundary checks:

```powershell
npm run test:enterprise-imports
```

Run browser regression checks:

```powershell
npx playwright install chromium
npm run test:e2e
```

Run the local Phase 0A gate:

```powershell
npm run check:enterprise
```

`npm run check:enterprise` includes lint. If lint fails on existing React Compiler memoization diagnostics outside enterprise files, fix or explicitly triage those diagnostics before treating the full gate as green.

## Runtime boundary

Runtime Stage A is deliberately limited:

- Uses `AgentHarness`.
- Uses an explicit approved coding-tool allowlist.
- Does not instantiate `AgentSession`.
- Does not use the Coding Agent RPC runtime.
- Does not use JSONL as enterprise state.

Runtime Stage B is not part of Phase 0A. Stage B is the later compatibility phase for full `pi-coding-agent` asynchronous session/RPC behavior.

## Data ownership boundary

- PostgreSQL is the future authority for enterprise metadata, run state, authorization policy, and audit metadata.
- MinIO stores bytes only, such as future run artifacts.
- Object storage must not become the policy or authorization authority.
- Phase 0A only bootstraps MinIO and checks health; artifact APIs, authorization, lifecycle, and retention are later-phase work.

## Phase 0B: Versioned Session Broker

Phase 0B implements the PostgreSQL-backed session broker that replaces JSONL
for enterprise session persistence. The broker enforces atomic compare-and-set
mutations so concurrent writes produce version conflicts instead of data loss.

### Package: `@pi-web/enterprise-session-broker`

Location: `packages/enterprise-session-broker`

Key modules:
- `src/db.ts` — PostgreSQL Pool connection, schema bootstrap
- `src/broker.ts` — SessionBroker with transactional create/open/list/fork/delete, appendAndAdvance, moveLeaf
- `src/storage.ts` — BrokeredSessionStorage implementing SessionStorage<EnterpriseSessionMetadata>
- `src/repo.ts` — PostgresSessionRepo implementing SessionRepo
- `src/types.ts` — TypeScript interfaces for all broker contracts

### Running broker tests

Start PostgreSQL first:

```powershell
docker compose --env-file .env.enterprise.example -f compose.enterprise.yml up -d postgres
```

Run broker tests:

```powershell
$env:PI_POSTGRES_URL = "postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise"
npx vitest run packages/enterprise-session-broker/test/ -v
```

### Runtime Stage A wiring

The enterprise worker (`@pi-web/enterprise-worker`) can create an AgentHarness
backed by the broker via `createBrokeredHarness()` in `src/brokered-runtime.ts`.
This factory accepts a RunEnvelope and a database connection, opens or creates
the conversation session in PostgreSQL, and returns the harness with the session.

### Design documents

- Spec: `docs/superpowers/specs/2026-07-11-enterprise-phase-0b-versioned-session-broker-design.md`
- Plan: `docs/superpowers/plans/2026-07-11-enterprise-phase-0b-versioned-session-broker.md`
