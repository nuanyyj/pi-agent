# Pi Enterprise Agent Platform

Enterprise-grade agent platform built on top of pi-web.

## Quick Start (Local Development)

```bash
# 1. Start infrastructure
docker compose --env-file .env.enterprise.example -f compose.enterprise.yml up -d

# 2. Set environment
export PI_POSTGRES_URL="postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise"

# 3. Run dev server
npm run dev
```

Open http://localhost:30141, click "Enterprise" in the top bar.

## Production Deployment

```bash
# 1. Create production env file
cp .env.enterprise.example .env.production
# Edit .env.production with real secrets

# 2. Build and start all services
docker compose -f compose.enterprise.prod.yml --env-file .env.production up -d --build

# 3. Check health
docker compose -f compose.enterprise.prod.yml ps
```

## Environment Variables

### Required

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_POSTGRES_URL` | PostgreSQL connection string | — |
| `PI_POSTGRES_DB` | Database name | `pi_enterprise` |
| `PI_POSTGRES_USER` | Database user | `pi_enterprise` |
| `PI_POSTGRES_PASSWORD` | Database password | — |
| `PI_MINIO_ROOT_USER` | MinIO access key | — |
| `PI_MINIO_ROOT_PASSWORD` | MinIO secret key (≥32 chars) | — |

### Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_AUTH_MODE` | Auth mode: `token` or `oidc` | `token` |
| `PI_AUTH_TOKEN` | Bearer token for API auth (empty = no auth) | — |
| `PI_OIDC_ISSUER` | OIDC provider issuer URL | — |
| `PI_OIDC_AUDIENCE` | Expected audience claim | — |

### MinIO / Object Storage

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_MINIO_ENDPOINT` | S3 endpoint URL | `http://127.0.0.1:19000` |
| `PI_MINIO_BUCKET` | Bucket name | `pi-artifacts` |
| `PI_MINIO_API_PORT` | MinIO API port (compose) | `19000` |
| `PI_MINIO_CONSOLE_PORT` | MinIO console port (compose) | `19001` |

### Worker Sandbox

| Variable | Description | Default |
|----------|-------------|----------|
| PI_WORKER_MODE | local or docker | local |
| PI_WORKER_DOCKER_IMAGE | Docker image for sandboxed workers | pi-enterprise-worker |

### LLM Provider Keys

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_API_KEY` | Google AI API key |

### Application

| Variable | Description | Default |
|----------|-------------|---------|
| `PI_APP_PORT` | Application port | `30141` |
| `PI_POSTGRES_PORT` | PostgreSQL port (compose) | `5432` |

## Architecture

```
Browser → Next.js (control plane) → PostgreSQL (state)
                ↓
         Worker Process (per run)
                ↓
         AgentHarness → LLM APIs
                ↓
         MinIO (artifacts)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/enterprise/v1/auth` | Auth status & validation |
| `POST` | `/api/enterprise/v1/conversations` | Create conversation |
| `GET` | `/api/enterprise/v1/conversations` | List conversations |
| `GET` | `/api/enterprise/v1/conversations/[id]` | Conversation detail |
| `DELETE` | `/api/enterprise/v1/conversations/[id]` | Delete conversation |
| `POST` | `/api/enterprise/v1/runs` | Create run (spawns worker) |
| `GET` | `/api/enterprise/v1/runs` | List runs |
| `GET` | `/api/enterprise/v1/runs/[id]` | Run detail |
| `GET` | `/api/enterprise/v1/runs/[id]/events` | SSE event stream |
| `POST` | `/api/enterprise/v1/runs/[id]/cancel` | Cancel run |
| `GET` | `/api/enterprise/v1/runs/[id]/artifacts` | List run artifacts |
| `POST` | `/api/enterprise/v1/runs/[id]/artifacts` | Upload artifact |
| `GET` | `/api/enterprise/v1/artifacts?key=...` | Download artifact |
| `GET` | `/api/enterprise/v1/audit` | Query audit events |

## Database Schema

Tables created automatically on first connection:

- `enterprise_sessions` — Conversations (soft-delete via `deleted_at`)
- `enterprise_session_entries` — Conversation entries (CAS versioning)
- `enterprise_runs` — Run records with status lifecycle
- `enterprise_run_events` — Streaming events per run
- `enterprise_audit_events` — Append-only audit log
- `enterprise_schema_migrations` — Schema version tracking
