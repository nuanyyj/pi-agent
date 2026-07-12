# Enterprise Development

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

## Phase 1A: Worker Main Loop

Phase 1A upgrades the enterprise worker from preflight-only validation to
actual agent execution.

### RunEnvelope (extended)

The RunEnvelope now includes model configuration and user input:

```json
{
  "protocolVersion": 1,
  "runtimeProfile": "agent-harness-v1",
  "organizationId": "org-1",
  "conversationId": "conv-1",
  "runId": "run-1",
  "attempt": 1,
  "workspaceRoot": "/workspace",
  "toolNames": ["read", "bash", "edit", "write"],
  "modelProvider": "openai",
  "modelId": "gpt-4o",
  "userInput": "Hello, world!",
  "systemPrompt": "You are a helpful coding assistant."
}
```

### Running the worker

```powershell
$env:PI_RUN_ENVELOPE_PATH = "path/to/envelope.json"
$env:PI_POSTGRES_URL = "postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise"
$env:OPENAI_API_KEY = "sk-..."
npx tsx packages/enterprise-worker/src/main.ts
```

### Control plane and Docker worker configuration

Enterprise mode defaults to OIDC. The issuer must provide `sub`, an organization
claim (`org_id` or `organization`), and a roles claim (`roles` by default).

```powershell
$env:PI_AUTH_MODE = "oidc"
$env:PI_OIDC_ISSUER = "https://id.example.com/realms/pi"
$env:PI_OIDC_AUDIENCE = "pi-enterprise"
$env:PI_OIDC_ROLES_CLAIM = "roles"

# Multiple allowed roots use the platform PATH separator (`;` on Windows).
$env:PI_ENTERPRISE_WORKSPACE_ROOTS = "E:\projects;E:\customer-workspaces"

$env:PI_WORKER_MODE = "docker"
$env:PI_WORKER_DOCKER_IMAGE = "pi-enterprise-worker:local"
docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com `
  -f Dockerfile.worker -t pi-enterprise-worker:local .
```

Conversation creation rejects missing paths and paths outside
`PI_ENTERPRISE_WORKSPACE_ROOTS`. Docker workers mount the selected workspace at
`/workspace`, run as a non-root user with all Linux capabilities dropped, and
only receive allowlisted model provider environment variables.

### Key modules

- `src/run-executor.ts` — Core execution: envelope → PG → brokered harness → model → prompt → events
- `src/main.ts` — CLI entry point (reads envelope file, connects PG, runs executor)
- `src/brokered-runtime.ts` — Creates AgentHarness backed by PG session broker
- `src/coding-tools.ts` — Approved coding tool allowlist for Stage A

### Event collection

Harness events are sanitized (API keys, tokens, and headers stripped), written
to `enterprise_run_events` in sequence, and announced with PostgreSQL
`LISTEN/NOTIFY` for real-time SSE streaming. The worker flushes pending events
before closing its database connection.

### Design documents

- Platform design: `docs/superpowers/specs/2026-07-10-enterprise-agent-platform-design.md`
- Phase 0B spec: `docs/superpowers/specs/2026-07-11-enterprise-phase-0b-versioned-session-broker-design.md`
- Phase 0B plan: `docs/superpowers/plans/2026-07-11-enterprise-phase-0b-versioned-session-broker.md`
