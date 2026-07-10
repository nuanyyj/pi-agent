# Pi Web Enterprise Agent Platform Design

Status: Revision 5 pending user review; baseline approved on 2026-07-10  
Scope: First production-capable private-deployment release  
Source projects: `pi-web-main` and `pi-main`

## 1. Summary

This design evolves `pi-web-main` from a local, single-user browser UI into a
private-deployment enterprise agent platform. The existing Pi chat, session,
tool-call, model, skill, plugin, file preview, and worktree capabilities remain
the product foundation. Enterprise identity, authorization, agent lifecycle,
durable execution, audit, and observability are added around that foundation.

The platform uses a modular control plane and an independent execution plane:

```text
Browser
  |
  v
Pi Web control plane (Next.js)
  |- Enterprise workspace and Agent Studio
  |- Identity, organization, and RBAC
  |- Agent versioning and publishing
  |- Run center, approvals, audit, and administration
  |- API/BFF and SSE event endpoints
  |
  |- PostgreSQL: business data, durable jobs, run events
  |- MinIO object storage: attachments and artifacts
  |- Secret store: model and integration credentials
  `- Execution queue
        |
        v
    Agent workers
      |- Isolated run workspace
      |- Stage A: pi-agent-core AgentHarness plus approved coding tools
      |- Stage B: full pi-coding-agent compatibility after async refactor
      |- pi-ai model access
      |- Authorized tools, skills, and plugins
      `- Events, usage, artifacts, and audit output
```

The first release targets one privately deployed enterprise. Every business
record and authorization path still includes `organization_id` so that a later
multi-tenant deployment does not require a data-model rewrite.

### 1.1 Tenancy and Trust Model

The first release uses **physical deployment isolation between enterprises**:
one enterprise owns one control-plane deployment, database, object-storage
namespace, secret-store root, and worker pool. It can contain multiple internal
organizations for delegated administration, and those organizations use
logical isolation inside the deployment.

Logical isolation uses all of the following, not only an application-supplied
tenant filter:

- `organization_id` is non-null on every organization-owned row and is part of
  unique keys and foreign keys where PostgreSQL permits it.
- PostgreSQL row-level security derives the active organization from a
  transaction-local, server-authenticated context. Application roles cannot
  bypass RLS.
- Object keys begin with a non-guessable organization namespace, and signed
  access is issued only after an application authorization decision.
- Secret, cache, queue, worker, metric, and audit records carry the same
  organization boundary.
- Cross-organization administration is unavailable to normal product roles.

Multi-enterprise SaaS remains a deferred deployment model. A later SaaS design
must re-evaluate noisy-neighbor protection, per-tenant encryption roots,
regional residency, tenant-aware backups, and operator access; the presence of
`organization_id` alone does not claim SaaS-grade isolation.

Trust boundaries are:

1. Browser to control plane: untrusted input over an authenticated session.
2. Control plane to PostgreSQL/object/secret services: trusted service identity
   with least-privilege credentials.
3. Control plane to worker: versioned durable commands authenticated as a
   worker service identity.
4. Worker supervisor to runtime sandbox: Pi and all model/tool output are
   untrusted; the sandbox receives capability-scoped mounts, network routes,
   and credentials.
5. Platform to model/tool providers: explicit data-egress boundary subject to
   organization policy and audit.

## 2. Current State

`pi-web-main` is currently a local developer workbench:

- Next.js API routes read Pi session files directly from the local filesystem.
- Sending a prompt creates an in-process `AgentSession` through
  `lib/rpc-manager.ts`.
- Active sessions are registered in `globalThis.__piSessions`.
- Per-session SSE streams Pi runtime events to the browser.
- Model credentials, settings, plugins, and skills come from the local Pi
  configuration directory.
- File access is restricted to known local project roots.

`pi-main` supplies reusable execution capabilities:

- `@earendil-works/pi-ai`: multi-provider model API.
- `@earendil-works/pi-agent-core`: general agent loop, state, tools, sessions,
  skills, compaction, and storage abstractions.
- `@earendil-works/pi-coding-agent`: coding-agent runtime, RPC protocol,
  workspace tools, resource loading, and a legacy file-oriented SessionManager.
- `@earendil-works/pi-orchestrator`: experimental process supervision. It is a
  useful reference for development prototypes only. It is not a production
  dependency or platform contract.

The current architecture has no organization boundary, user identity, RBAC,
durable job queue, enterprise audit trail, credential isolation, or
restart-safe execution ownership. Local session files are not an enterprise
business database and are not used by enterprise mode.

## 3. Goals

The first release must provide a complete enterprise agent lifecycle:

1. An administrator creates or connects an enterprise identity and manages
   members, groups, roles, model resources, and policies.
2. An agent developer creates a draft Agent, configures it, and tests it in a
   Playground that reuses the current Pi Web chat experience.
3. The developer publishes an immutable Agent version to selected members or
   groups.
4. A member discovers an authorized Agent and starts a conversation or
   one-shot run.
5. A worker executes the selected version independently of the browser and Web
   process lifecycle.
6. Users can follow events in real time, reconnect without losing state, and
   inspect the final result and artifacts.
7. Operators can diagnose, cancel, and retry runs under explicit retry rules.
8. Security-relevant configuration and execution actions are auditable.

Additional goals:

- Preserve Pi's model, tool, skill, plugin, compaction, and branching behavior
  through storage-neutral session APIs where compatible with enterprise
  isolation.
- Support both a general assistant profile and a coding assistant profile.
- Run as a compact private-deployment stack before introducing independent
  microservices.
- Keep execution backends replaceable so local processes, OCI containers, and
  Kubernetes Jobs can be supported without changing product APIs.

## 4. Non-Goals

The first release does not include:

- Visual workflow or graph authoring.
- General multi-agent orchestration.
- External schedules, webhooks, or event triggers.
- Public marketplace or public agent sharing.
- Billing and payment collection.
- A full managed RAG knowledge-base product.
- Kubernetes as a mandatory deployment target.
- Migration of legacy local Pi session files.

Enterprise knowledge can initially be supplied through authorized files,
skills, plugins, and tools. Knowledge-base ingestion is a separate subsequent
project with its own retrieval, authorization, and evaluation design.

## 5. Design Principles

1. **PostgreSQL is the only enterprise session and business-state authority.**
   Enterprise mode does not read, write, or archive local Pi session files.
2. **Published versions are immutable.** A Run is always attributable to a
   concrete version and resolved policy snapshot.
3. **Execution survives UI and Web restarts.** A browser connection is an
   observer, not the owner of a task.
4. **Authorization is enforced at every server boundary.** UI visibility is
   never a security control.
5. **Secrets are referenced, not copied.** They cannot appear in Agent
   versions, session entries, run events, logs, or browser responses.
6. **Side effects are not blindly retried.** Retry decisions use explicit
   idempotency and execution-phase evidence.
7. **Start modular, preserve extraction boundaries.** The control plane is a
   modular monolith; execution is independently deployable from the start.
8. **Versions bind behavior, deployments bind environment.** Published Agent
   versions pin content and dependency versions; separately versioned
   deployment bindings resolve environment-specific paths, endpoints, and
   credential aliases for each Run.
9. **Audit evidence is tamper-evident.** Product tables support queries, while
   chained signatures and external immutable export provide compliance
   evidence.

## 6. Product Information Architecture

### 6.1 Primary Navigation

- **Overview**: available Agents, recent runs, failures, usage, cost, worker
  health, and outstanding approvals.
- **Agents**: create, search, copy, archive, configure, version, publish, and
  authorize Agents.
- **Run Center**: live and historical runs, events, tool calls, artifacts,
  errors, usage, cancellation, and retry.
- **Resources**: models, tools, skills, plugins, connectors, and credentials.
- **Team & Access**: members, groups, roles, and resource grants.
- **Audit Log**: security and administration event search and export.
- **Settings**: organization, authentication, retention, quotas, storage, and
  execution defaults.

The interface remains quiet and work-focused. The existing Pi Web workspace is
extended rather than replaced, but global navigation and route context are no
longer forced into one 260 px column:

- A compact global top bar owns organization switching, primary product
  navigation, global status, and the account/session menu.
- The existing collapsible 260 px left panel is route-specific context. In a
  conversation it shows conversations or project/files as mutually exclusive
  tabs; in management routes it shows filters or the current resource tree.
- The center remains the primary chat, editor, table, timeline, or detail work
  surface. The resizable right panel remains the file, artifact, Run, or tool
  inspector.
- Project, conversation, and file trees are never stacked simultaneously in
  the left panel. Switching context preserves each view's selection and scroll
  state without duplicating navigation in the right panel.

### 6.2 Agent Studio

An Agent detail view contains:

```text
Overview | Build | Playground | Versions | Runs | Access
```

The Build view configures:

- Identity: name, description, icon, owner, and tags.
- Runtime profile: general assistant or coding assistant.
- Prompt: system prompt, startup context, welcome text, and examples.
- Model policy: primary model, fallback models, reasoning level, token limit,
  duration limit, and cost budget.
- Capabilities: selected tools, skills, plugins, and capability-specific
  policies.
- Execution: working-directory template, filesystem roots, network policy,
  environment references, and resource limits.
- Contract: input schema, output expectations, and optional artifact rules.

The Playground uses a draft version. Published catalog usage always resolves
an immutable published version.

### 6.3 Agent Catalog

Members see only published Agents granted to them directly, through a group,
or through an organization-wide grant. Each catalog entry shows its owner,
purpose, version, supported inputs, and relevant usage policy. Configuration,
system prompts, and credentials remain hidden unless the member also has
maintenance permission.

### 6.4 Frontend Extension Strategy

Enterprise UI is implemented inside the existing `pi-web-main` Next.js
application. There is no replacement frontend, separate admin template, or
marketing landing page. The first screen remains a usable Agent workspace.

The existing workspace behavior is preserved while global navigation moves to
the top bar:

```text
Global top bar: organization | product navigation | status | account
Left route context         Center workspace             Right inspector
conversation/project      chat, Agent Studio,          files, artifacts,
files OR route filters    catalog, tables, details     run/tool details
```

- Desktop retains the collapsible 260 px left panel and resizable/collapsible
  right panel behavior.
- Mobile retains the slide-in left drawer and full-width inspector behavior.
- Light/dark themes, CSS variables, typography, message density, completion
  sound, drag/drop, and responsive breakpoints evolve from the current code.
- Management views use dense tables, split panes, tabs, forms, and drawers in
  the same shell; they do not introduce dashboard-card or landing-page styling.

Existing component treatment is explicit:

| Existing module | Action | Enterprise use |
| --- | --- | --- |
| `components/AppShell.tsx` | Extend incrementally | Organization context, route state, three-panel shell, modal/drawer host |
| `components/SessionSidebar.tsx` | Split presentation from local data | Route-specific conversation, project, or file context; global navigation moves to the top bar |
| `ChatWindow`, `ChatInput`, `MessageView`, `MarkdownBody`, `ChatMinimap` | Reuse presentation and interaction | Catalog conversations, draft Playground, live Run rendering |
| `BranchNavigator` | Reuse only its view primitives | A dedicated enterprise tree controller performs cursor pagination, lazy ancestry loading, capability checks, and asynchronous navigate/fork status |
| `FileExplorer` | Split tree presentation from data source | Local filesystem source stays local; enterprise source is authorized, lazy, child-paginated, and has no unrestricted watcher |
| `FileViewer`, `FileIcons`, `TabBar` | Reuse presentation with typed sources | Enterprise viewers receive authorized preview/download capabilities, never a raw local path |
| `ModelsConfig`, `SkillsConfig`, `PluginsConfig` | Reuse only low-level controls and layout | Enterprise pages use new schemas for organization scope, RBAC, immutable versions, approval, and server validation |
| `useTheme`, `useIsMobile`, `useAudio`, `useDragDrop` | Reuse | Existing cross-cutting browser behavior |
| `useAgentSession` | Keep local-only and extract display reducers | Enterprise hooks use separate Conversation, Run, event, and Artifact clients |

Local sessions and enterprise conversations do not implement a common
lifecycle interface. `LocalSessionClient` retains the current immediate,
process-bound behavior. Enterprise hooks compose capability-specific clients:

```ts
interface EnterpriseConversationClient {
  start(input: StartConversationInput, intentKey: string): Promise<ConversationStart>;
  get(id: string): Promise<ConversationSnapshot>;
  getTreePage(id: string, cursor?: TreeCursor): Promise<TreePage>;
  navigate(id: string, entryId: string, version: number): Promise<OperationReceipt>;
  fork(id: string, entryId: string, intentKey: string): Promise<OperationReceipt>;
  capabilities(id: string): Promise<ConversationCapabilities>;
}

interface EnterpriseRunClient {
  create(input: CreateRunInput, intentKey: string): Promise<RunSnapshot>;
  get(runId: string): Promise<RunSnapshot>;
  findByIntentKey(intentKey: string): Promise<RunSnapshot | null>;
  getEvents(runId: string, query: EventPageQuery): Promise<EventPage>;
  subscribe(runId: string, after: EventCursor): AsyncIterable<VisibleRunEvent>;
  requestCancel(runId: string, commandKey: string): Promise<CommandReceipt>;
  forceTerminate(runId: string, commandKey: string): Promise<CommandReceipt>;
  retry(runId: string, intentKey: string): Promise<RunSnapshot>;
}

interface EnterpriseArtifactClient {
  list(runId: string, cursor?: ArtifactCursor): Promise<ArtifactPage>;
  getMetadata(id: string): Promise<ArtifactMetadata>;
  getPreview(id: string): Promise<ArtifactPreviewGrant>;
  getDownload(id: string): Promise<ArtifactDownloadGrant>;
}
```

Only normalized, immutable presentation models and reducers are shared across
local and enterprise hooks. A component may be visually shared when its data
contract is truly common; otherwise local and enterprise controllers render
the same lower-level primitives. Universal components with mode conditionals
are rejected in review when separate controllers make the boundary clearer.

Enterprise chat distinguishes three UI states:

1. A local draft or pending intent may render immediately as `submitting`.
2. A server-acknowledged intent becomes a durable queued Run with its server
   ID and state version.
3. Execution, messages, effects, files, approvals, branch changes, and terminal
   outcome are derived only from committed server snapshots and events.

Optimistic updates are limited to reversible presentation state such as input
text, tab selection, or an explicitly pending bubble. The UI never claims a
tool effect, file write, approval, navigate/fork completion, or Run success
before durable acknowledgement. On an ambiguous create response it queries by
the original intent key instead of sending another create request.

Enterprise routes remain in the same App Router application:

- `/`: authorized Agent workspace and recent conversations.
- `/catalog`: published Agent catalog.
- `/agents` and `/agents/[agentId]/*`: Agent list and Studio tabs.
- `/runs` and `/runs/[runId]`: Run Center and live Run detail.
- `/resources/*`: models, tools, Skills, plugins, connectors, environments.
- `/team`, `/audit`, `/settings/*`: enterprise administration.

Enterprise mode may hide a route or action based on authorization for usability,
but every loader, mutation, stream, and download still enforces permission on
the server. URL state remains deep-linkable and refresh-safe.

### 6.5 Authorization-Aware UI and Session Context

`GET /api/enterprise/v1/me/context` returns the active organization,
authentication strength/time, authorization policy version, session expiry,
and coarse navigation capabilities. Resource APIs return operation-specific
capabilities such as `canEdit`, `canCancel`, and `canReadContent`, together with
server-masked fields. Unauthorized prompts, secrets, connector settings, and
diagnostic content are omitted rather than sent disabled or hidden.

`Can` components and capability hooks improve usability only; they are not an
authorization boundary. The permission cache is memory-only and keyed by user,
organization, and policy version. A user-context event stream signals role,
membership, policy, or session revocation. The client then invalidates queries,
closes Run streams, reloads context, and redirects to login or an authorized
route as needed.

Organization switching validates active membership server-side, rotates the
session and CSRF identifiers, updates the active organization transactionally,
and reloads all capabilities. The account UI supports logout, logout of other
sessions, session inventory, forced-logout feedback, concurrent-session policy,
and visible absolute/sliding expiry. Browser storage never contains bearer
tokens or permission-bearing field data.

### 6.6 Enterprise Responsive Behavior

- Dense tables become prioritized list rows with filter and sort sheets on
  narrow screens; columns are not merely squeezed or silently removed.
- Agent Studio becomes stacked sections or explicit steps with a sticky save/
  submit area and preserved validation state.
- Run, audit, conversation, and approval timelines use windowed rendering and
  collapsed tool/process groups on desktop and mobile.
- Approval decisions remain available with risk summary, diff/evidence,
  required reason, and recent-MFA step-up when policy requires it.
- An operation that cannot be made safe or usable on mobile is labeled as
  desktop-required with a read-only mobile view; it is never silently hidden.

### 6.7 Audit and Approval Workspaces

Audit search supports time, actor, action, target, outcome, severity, source/IP,
correlation ID, Agent, and Run filters, plus saved searches. CSV and JSON export
run server-side with the caller's field masking and generate an audited
Artifact rather than exporting hidden browser data.

The approval inbox and detail view show request type, requester, target, risk,
sanitized configuration or operation diff, expiry, required roles, and
evidence. Approve and reject require a reason; sensitive decisions require
recent MFA, and policy may prohibit self-approval. In-app, email, and chat
notifications deep-link to the authenticated detail view and can never carry a
direct approval action.

## 7. Platform Components

### 7.1 Web Control Plane

The existing Next.js application remains the Web entry point. Its route
handlers act as a BFF and call explicit application modules rather than reading
local Pi state directly.

Control-plane modules:

- Identity and organization.
- Authorization and policy evaluation.
- Agent registry and versioning.
- Resource and credential registry.
- Conversation and run management.
- Durable job dispatch.
- Event query and SSE delivery.
- Approval management.
- Artifact access.
- Audit reporting.
- Usage, quota, and cost accounting.

Modules expose typed service interfaces. Route handlers perform request
parsing, session resolution, and response mapping; business rules remain in
the service layer so that CLI or future API consumers receive identical
authorization and state behavior.

Each module owns its service interface, repository interface, database tables,
and emitted domain events. Modules cannot query another module's tables or
import its repository implementation. Allowed dependencies are:

```text
identity -----> authorization
                    ^
resources ----------|
                    |
agent-registry ------|
      |              |
      v              |
release-management -|
      |
      v
conversation/run-management ---> dispatch ---> worker protocol
      |                              |
      +--> approval                  +--> event ingestion
      +--> artifact-access           +--> usage accounting
      `--> audit (append-only sink from every module)
```

Authorization, audit, policy, and transaction/outbox utilities are platform
kernel services. They expose narrow APIs and cannot depend on product modules.
Cross-module state changes use an application service transaction or a
versioned domain event. This prevents a future extraction from depending on
undocumented shared-table behavior.

The code layout makes those boundaries enforceable:

```text
platform/
  kernel/{auth,authorization,audit,db,outbox}/
  modules/
    identity/{domain,application,infrastructure,api}/
    resources/{domain,application,infrastructure,api}/
    agents/{domain,application,infrastructure,api}/
    releases/{domain,application,infrastructure,api}/
    conversations/{domain,application,infrastructure,api}/
    runs/{domain,application,infrastructure,api}/
    approvals/{domain,application,infrastructure,api}/
    artifacts/{domain,application,infrastructure,api}/
    usage/{domain,application,infrastructure,api}/
  local/
```

A module owns its tables, migrations, repositories, and application commands.
No module imports another module's infrastructure folder or reads its tables.
Cross-module queries use published application interfaces; asynchronous state
changes use versioned events. All permission decisions call the kernel
`AuthorizationService`, which is the only component allowed to interpret roles,
grants, policy versions, and authentication strength. Architecture lint rules
and import/SQL ownership tests fail builds on forbidden dependencies or direct
cross-module table access.

### 7.2 PostgreSQL

PostgreSQL stores business entities, run state, run events, audit records,
usage, and the first-release durable queue. A PostgreSQL-backed queue is chosen
for the first release because it supports transactional job creation, leasing,
and private deployments without another mandatory service.

Workers lease jobs using row locking, record a lease owner and expiry, and
renew the lease with heartbeats. Queue operations sit behind a repository
interface so a dedicated broker can be introduced later if measured throughput
requires it.

The queue implementation uses `FOR UPDATE SKIP LOCKED`, short transactions,
and a deterministic ordering of priority plus creation time. A job stores
`available_at`, `lease_owner`, `lease_expires_at`, `attempt_count`,
`max_attempts`, and the last stable error code. The worker commits the lease
before preparing a sandbox; it never holds a database lock during execution.

Lease recovery is performed by a singleton logical scheduler elected through
a PostgreSQL advisory lock. Expired jobs are classified before requeue:

- no execution started: requeue with exponential backoff and jitter;
- execution started but no side effect recorded: retry only when policy allows;
- possible or confirmed side effect: fail as `worker_lost` for operator review;
- attempts exhausted or non-retryable error: move to a dead-letter state.

Dead-letter jobs retain their Run, attempts, error history, and audit trail.
Operators can create a new attempt after correcting configuration; they cannot
reset or overwrite the failed attempt. Database deadlocks and serialization
failures retry the short queue transaction with bounded jitter, not the Agent
execution.

Defaults are a 30-second lease renewed every 10 seconds using database time,
with the worker stopping new operations immediately if renewal fails. Queue
transactions retry at most five times with 50-500 ms jitter. Versioned Run
policy can lower these limits; raising them requires operator policy permission.

### 7.3 Object Storage

An object-storage abstraction stores:

- User attachments.
- Generated files and exports.
- Large tool results that should not be embedded in `RunEvent`.
- Diagnostic bundles allowed by policy.

The first release uses self-hosted MinIO through the `ArtifactStore` interface.
Development may use either MinIO in the local Compose profile or a filesystem
adapter under a dedicated platform data root. Artifacts are written to a
temporary key and committed only after checksum and metadata validation. MinIO
bucket names and object keys are never exposed as authorization boundaries;
PostgreSQL metadata and platform policy remain authoritative.

### 7.4 Secret Store

Credentials are accessed through a `SecretStore` interface. The initial
private-deployment adapter uses envelope encryption: a deployment-provided
root key protects per-record data keys, and ciphertext is stored separately
from normal Agent configuration. An external Vault/KMS adapter can replace it.

Workers receive credentials only after presenting a short-lived, run-scoped
token. Returned values are held in worker memory, are never returned to the
browser, and are destroyed during run cleanup.

The control plane signs the run token with audience, worker ID, Run/attempt ID,
organization, credential aliases, permitted operations, issued-at, expiry, and
unique token ID. The SecretStore validates those claims and worker mTLS
identity before decrypting a value. Revocation is checked for every secret
fetch; tokens are single-run, short-lived, and renewed only while the worker
owns a valid lease.

Root-key administration, credential administration, and Agent use are separate
permissions. Key rotation creates a new encryption-key version, re-wraps data
keys asynchronously, and retains old key versions only until all ciphertext is
migrated. Every create, read, rotate, revoke, and failed access is audited
without recording plaintext.

### 7.5 Agent Worker

A worker:

1. Leases one queued run.
2. Resolves the immutable version and policy snapshot.
3. Creates an isolated workspace.
4. Retrieves run-scoped secrets.
5. Opens the PostgreSQL-backed conversation through the session broker.
6. Starts the Pi runtime through the selected execution provider.
7. Normalizes and appends runtime events.
8. Handles cancellation and approval responses.
9. Persists session entries, usage, result, and artifacts.
10. Cleans up the workspace and credentials.

The worker is a separate process and deployment unit. Development can use a
local process provider. A production-ready deployment uses an OCI container
provider with filesystem, process, CPU, memory, and network restrictions.

The supervisor process holds queue and SecretStore clients; the untrusted Pi
runtime runs in a child sandbox and never receives database, object-store, or
control-plane service credentials. Runtime access is mediated through local
capability brokers for artifacts, files, secrets, and outbound connections.

### 7.6 Worker Protocol

The first release uses PostgreSQL as a durable transport but not as an
unrestricted shared database. Separate database roles and repository functions
limit workers to leasing eligible jobs, appending events for owned attempts,
reading commands for those attempts, and updating heartbeats.

The wire contract is versioned independently from database schema:

```text
RunEnvelopeV1
  protocolVersion, organizationId, runId, attemptId
  agentVersionId, dependencyLockId, deploymentBindingVersionId
  inputArtifactRefs, conversationId, baseEntryId, expectedConversationVersion
  executionPolicy, deadline, idempotencyKey, runTokenRef

WorkerEventEnvelopeV1
  protocolVersion, organizationId, runId, attemptId
  sequence, eventId, eventType, occurredAt
  classification, sanitizedPayload, artifactRefs

WorkerCommandEnvelopeV1
  protocolVersion, commandId, runId, attemptId
  commandType(request_cancel | force_terminate | pause | resume | approval_resolution)
  expectedStateVersion, issuedAt, expiresAt, payload
```

Job creation uses a transactional outbox. Workers use a command inbox with a
unique `command_id`, acknowledge commands idempotently, and reject commands for
stale attempts or unexpected state versions. Event append uses unique
`(attempt_id, sequence)` and `event_id` constraints. A worker may reconnect and
resume after the last acknowledged event sequence without duplicating state.
Only the Approval module may emit an `approval_resolution`; browser clients
decide through the Approval API and cannot manufacture a worker command.

Protocol compatibility is negotiated through worker heartbeats. The scheduler
assigns a job only to a worker that supports the Run's protocol, runtime
profile, isolation features, and policy capabilities. Contract fixtures are
stored with the code and tested in both control-plane and worker packages.

### 7.7 Execution Provider

The platform defines its own stable execution boundary rather than exposing
`pi-orchestrator` directly. An execution provider accepts a resolved run spec,
emits normalized events, accepts approval responses, supports cancellation,
and returns a terminal result plus artifacts.

Initial adapters:

- `LocalProcessExecutionProvider`: development only; enterprise mode refuses
  it unless the deployment is explicitly marked non-production.
- `OciExecutionProvider`: production isolation.

A future Kubernetes adapter uses the same contract. The experimental Pi
orchestrator may inform the local adapter implementation, but it is not linked
into the production provider and changes to it cannot alter platform APIs.

The provider-neutral contract is:

```ts
interface ExecutionProvider {
  readonly capabilities: ExecutionCapabilities;
  start(spec: ExecutionSpec, events: ExecutionEventSink): Promise<ExecutionHandle>;
  control(handle: ExecutionHandle, command: ExecutionControl): Promise<void>;
  inspect(handle: ExecutionHandle): Promise<ExecutionStatus>;
  wait(handle: ExecutionHandle): Promise<ExecutionResult>;
  cleanup(handle: ExecutionHandle): Promise<void>;
}
```

`ExecutionSpec` contains provider-neutral resource limits, immutable input and
conversation references, mount declarations, network destinations, secret
aliases, runtime profile, and deadline. It never contains secret plaintext.
Provider capabilities declare support for read-only mounts, copy-on-write
workspaces, network policy, suspension, hard cancellation, and recovery. Run
validation fails before dispatch if the selected provider cannot enforce the
required policy; it never silently weakens isolation.

### 7.8 Pi Runtime Profiles

- **Runtime Stage A, required for the first enterprise release:** coding
  assistants run on `@earendil-works/pi-agent-core` `AgentHarness` with an
  explicitly approved tool set assembled from the `AgentTool` factories exported
  by `@earendil-works/pi-coding-agent`. `createCodingTools` supplies the baseline
  read, bash, edit, and write tools; grep, find, ls, or future tools are added
  only when the Agent version and runtime policy grant them. Stage A does not
  instantiate `AgentSession` or `SessionManager` and does not claim compatibility
  with the Coding Agent RPC protocol, local resource loader, extension API,
  import/export behavior, or exact local branch and compaction semantics.
- **Runtime Stage B, after the first enterprise release:** the full Coding Agent
  runtime may replace Stage A only after its session, runtime-switching, export,
  and extension boundaries have asynchronous implementations and pass the same
  enterprise worker, session, policy, event, and failure conformance suites.
- **General assistant** uses the Stage A Agent Harness with an explicitly selected
  tool set and no implicit shell or project filesystem access.
- Every profile uses `@earendil-works/pi-ai`, the platform model policy, and the
  same runtime-neutral control-plane contracts.

Runtime-specific events are normalized into one platform event contract while
the original Pi payload can be retained in a restricted diagnostic field. Agent,
Conversation, Run, command, event, and artifact APIs never expose which Pi
runtime implementation served the Run. A versioned runtime profile in the Run
dependency lock makes the selected implementation immutable for that Run.

### 7.9 Enterprise Session and Runtime Ports

`@earendil-works/pi-agent-core` already exposes asynchronous `SessionStorage`
and `SessionRepo` contracts whose entries model messages, model/tool changes,
labels, branches, and compaction independently of a file format. Enterprise
mode adds `PostgresSessionStorage` and `PostgresSessionRepo` behind a
supervisor-side broker. The generic storage interface is not itself the
enterprise concurrency contract because its append and leaf operations do not
carry an expected version. The broker therefore exposes atomic, versioned
commands such as `appendAndAdvance` and `moveLeaf`; each command binds the
organization, Conversation, Run/attempt, active lease, expected Conversation
version, parent/leaf, and capability token in one PostgreSQL transaction. A
conflict returns the current durable version and does not partially append.

The Stage A runtime receives a Run-scoped `BrokeredSessionStorage` proxy over a
private local channel. The proxy tracks the last committed version returned by
the broker and maps Agent Core session operations to the atomic broker commands.
The sandbox has no PostgreSQL credential, cannot select an organization or Run,
and cannot weaken the expected-version check.

Stage B is an explicit upstream `pi-main` program rather than a hidden platform
adapter:

1. Define an asynchronous `CodingSessionPort` covering every operation used by
   `AgentSession`, runtime switching, export, and extensions.
2. Replace concrete `SessionManager` exposure with capability-scoped asynchronous
   session and runtime interfaces.
3. Await every persistence-affecting operation and route enterprise commits
   through the same versioned session broker used by Stage A.
4. Preserve the existing local CLI runtime behind its local-only adapter without
   importing that adapter into an enterprise bundle.
5. Run differential compatibility tests for declared RPC commands, extensions,
   navigation, compaction, export, and event normalization before enabling the
   Stage B runtime profile.
6. Activate Stage B through a new immutable runtime-profile version; existing
   Agent versions and Runs remain pinned to Stage A unless explicitly republished.

Enterprise mode must not hydrate an in-memory file manager and persist a diff
after the Run: that would lose entries on worker failure and make optimistic
branch concurrency unverifiable. Each completed Pi entry is committed through
the broker as it is produced.

### 7.10 Skills and Plugins

The first enterprise release does not execute arbitrary third-party JavaScript
in the browser. Skills and plugins are server-side immutable resource versions
with content digest, publisher identity, signature status, SBOM, security-scan
result, declared capabilities, compatible runtime version, and approval state.
Publishing or enabling a version verifies its integrity and required
permissions; a Run pins the approved version and digest in its dependency lock.

Runtime code executes only inside the OCI sandbox and cannot expand the Run's
mounts, network destinations, secrets, or broker capabilities. Enterprise
plugin UI is rendered from trusted platform-owned schemas and declarative
manifests. Unauthorized users receive neither restricted resource metadata nor
actions. Downloaded custom frontend code, browser extension points, and a
third-party UI SDK are deferred until they receive a separate sandbox and
supply-chain design.

## 8. Data Model

All organization-owned tables include `organization_id`. IDs are opaque and
authorization queries always constrain both ID and organization.

### 8.1 Identity and Access

- `organizations`: enterprise identity, status, settings, and retention policy.
- `users`: global identity profile and authentication subject.
- `memberships`: user membership and status within an organization.
- `groups`, `group_members`: enterprise grouping.
- `roles`, `role_permissions`: built-in and future custom roles.
- `role_bindings`: role assignment at organization or resource scope.
- `identity_providers`: OIDC issuer, client metadata, claim mapping, status, and
  signing-key refresh state. Client secrets are SecretStore references.
- `auth_sessions`: hashed session identifier, user, organization, authentication
  strength, issued/expiry time, last activity, and revocation state.
- `service_accounts`: internal non-human worker and platform identity, owner,
  allowed scopes, expiry, and credential rotation metadata. Customer-issued
  API credentials for external Agent invocation remain a follow-up project.

### 8.2 Agent Registry

- `agents`: stable Agent identity, owner, lifecycle state, and default release
  channel.
- `agent_versions`: versioned configuration record with `draft` or `frozen`
  lifecycle metadata. A draft is editable; review submission freezes its
  configuration permanently, and later edits create a new draft version.
  Publishing, withdrawal, rollback, and retirement belong to `releases` and do
  not mutate the frozen version.
- `agent_grants`: principal, permission, and Agent scope.
- `resources`: model, tool, skill, plugin, or connector metadata.
- `resource_versions`: immutable tool schema/implementation digest, Skill
  content digest, plugin package/version/integrity, model catalog revision, or
  connector contract version.
- `dependency_locks`: the exact `resource_version` set and integrity metadata
  resolved for an Agent version.
- `environment_profiles`: stable environment identities such as development,
  staging, and production.
- `deployment_binding_versions`: immutable mappings from logical workspace,
  endpoint, storage, network-policy, and credential aliases to one environment.
- `release_channels`: Agent, environment, channel name, current release pointer,
  state version, and access policy.
- `releases`: Agent version, dependency lock, deployment binding version,
  channel, rollout rule, approval state, and lifecycle timestamps.
- `credentials`: encrypted secret metadata and SecretStore locator only.

An Agent version contains only logical environment references and their
required schemas. It cannot embed a host path, raw endpoint credential, or
secret value. A `deployment_binding_version` resolves those logical aliases for
one environment under separate authorization. Each Run pins all three:

```text
AgentVersion + DependencyLock + DeploymentBindingVersion
```

Run-time overrides are limited to declared input parameters and policy-bounded
limits such as a lower token budget. They cannot replace the system prompt,
dependency versions, mounts, network destinations, credentials, or raise a
resource limit. Environment changes create a new binding version and follow
the same review process; they do not mutate published Agent content.

Tool, Skill, and plugin dependencies are pinned by immutable version and
content/integrity digest. Models are pinned to provider, model ID, and platform
catalog revision. A remote model provider may still change server-side model
behavior; each Run records the provider's observed response model/version so
the platform does not overstate reproducibility it cannot control.

### 8.3 Conversations and Runs

- `conversations`: Agent, creator, kind (`conversation` or `task`), runtime
  profile, pinned release tuple, active leaf entry, state version, and lifecycle
  state.
- `runs`: one durable user intent or platform maintenance intent within a
  conversation, resolved Agent version, initiator, input, aggregate status,
  idempotency record, timing, usage, error code, and policy snapshot.
- `run_attempts`: Run, attempt number, predecessor attempt, trigger, execution
  state, lease metadata, worker/provider identity, effect boundary, timing, and
  terminal reason.
- `run_events`: Run and attempt ID, monotonically increasing internal sequence,
  event ID, type, timestamp, visibility, sanitized payload, and optional
  artifact reference.
- `run_commands`: Run and attempt ID, operation, command idempotency key,
  expected state version, issuer, reason, durable delivery status, expiry,
  failure code, and audit correlation.
- `run_inputs`: normalized text, attachment references, and input schema
  version.
- `artifacts`: object key, media type, size, checksum, owner, visibility, and
  retention state.
- `artifact_grants`: principal, artifact or artifact-set scope, permission, and
  expiry.
- `session_entries`: immutable typed Pi entry, parent entry, conversation of
  origin, schema version, logical sequence, payload, classification, Run, and
  integrity hash.
- `conversation_bases`: forked conversation, source conversation, base entry,
  authorization snapshot, and retention reference.
- `tool_effects`: attempt, tool-call ID, platform idempotency key, declared
  effect class, phase, external receipt, and terminal outcome.
- `approval_requests`: sanitized operation summary/diff, risk, evidence,
  approver policy, required authentication strength, status, expiry, decisions,
  reasons, and notification correlation.
- `idempotency_records`: organization, actor, conversation, operation, client
  intent key, canonical request hash, result resource, status, and expiry.

The relationship is explicit:

- A Conversation has many Runs; every submitted user turn creates exactly one
  Run. Historical Runs stay linked to the immutable entries they produced.
- Starting from the Catalog creates the Conversation and its initial Run in one
  transaction. A one-shot task still creates a Conversation with `kind=task`,
  which supplies authorization, history, artifacts, and retention scope.
- One active mutating Run owns a Conversation lease. Later turns enter its
  durable input queue; they are not browser-side steering state.
- Navigate changes the active leaf of the same Conversation with optimistic
  concurrency. Fork creates a new Conversation based on an authorized source
  entry; it does not rewrite or clone a historical Run.
- Manual compaction is an asynchronous maintenance Run. Automatic compaction
  is recorded as part of the active Run that required it.
- A retry does not reactivate a terminal attempt and is not a control command.
  It creates a new `run_attempt` under the same logical Run, linked to the
  predecessor and subject to effect-ledger retry rules.

Client intent idempotency uses UUIDv7 generated once when the user commits an
intent. Its scope is `(organization, actor, conversation, operation)`; before a
Conversation exists, the resolved Agent/release occupies the resource-scope
position. The server stores the canonical request hash before returning: the
same key and hash returns the existing resource, while the same key with
another payload returns `409 idempotency_conflict`. A key is retained for at
least 24 hours and never less than the Run's online retry window; the record
follows the Run's retention policy afterward. A timeout or refresh queries by
key and never generates a replacement key for the same intent.

### 8.4 Audit and Usage

- `audit_events`: append-only sequence, organization, actor and actor type,
  authentication context, action, target, outcome, policy decision, request
  correlation, source, sanitized before/after summaries, previous hash, event
  hash, and timestamp.
- `audit_checkpoints`: signed organization/period chain head and verification
  state.
- `audit_exports`: immutable-storage object, hash, period, legal-hold state,
  and external SIEM delivery receipt.
- `usage_records`: immutable usage ID, Run/attempt, model-price revision,
  provider receipt, token, cost, runtime, storage, egress, and Tool dimensions.
- `worker_heartbeats`: worker identity, capabilities, capacity, version, and
  health.

## 9. Authorization Model

The first release provides these separated roles:

| Role | Responsibilities |
| --- | --- |
| Owner | Break-glass ownership recovery and role assignment; not daily use |
| Identity Admin | Identity providers, members, groups, and role bindings |
| Security Admin | Security policy, credential policy, approvals, and revocation |
| Resource Admin | Models, tools, skills, plugins, connectors, and environments |
| Agent Developer | Create and maintain granted Agents; use their Playground |
| Operator | Inspect, cancel, retry, and diagnose granted runs |
| Member | Use granted published Agents; inspect own conversations |
| Auditor | Read configuration and Run/usage metadata plus verified audit exports; no content by default and no mutation |

No built-in daily-use role can both change security/audit policy and certify
its own change. Owner operations require recent strong authentication, a
reason, and a high-severity audit event. Deployments can require two-person
approval for Owner recovery, credential export, audit retention reduction, and
production release.

Permissions use explicit action names, including `identity.manage`,
`role.bind`, `security.policy.manage`, `resource.manage`, `resource.use`,
`agent.create`, `agent.read`, `agent.edit`, `agent.review`, `agent.publish`,
`agent.use`, `run.read`, `run.cancel`, `run.retry`, `approval.decide`,
`run.force_terminate`, `run.pause`, `conversation.navigate`,
`conversation.fork`, `artifact.read`, `audit.read`, and `audit.export`.

Roles define which actions a principal may perform. Resource grants define the
objects on which an otherwise permitted scoped action may be performed; a
grant cannot elevate a role. Authorization evaluation is deterministic:

1. Validate authentication, membership, organization, session revocation, and
   required authentication strength.
2. Apply organization policy denials; an explicit policy denial always wins.
3. Union active direct and group role permissions at the requested scope.
4. Require a matching resource grant for scoped resources unless the role has
   an explicit organization-wide scope.
5. Apply lifecycle, separation-of-duties, quota, and approval constraints.
6. Default to deny when any required fact or relationship is absent.

Group membership and role changes invalidate authorization cache entries and
active SSE subscriptions. Ownership is metadata, not an implicit bypass; the
creator receives an explicit maintainer grant in the creation transaction.

Every API route, SSE subscription, artifact download, approval decision, and
worker control request performs server-side authorization. Signed artifact
URLs are short-lived and issued only after authorization.

## 10. Agent Version and Publishing Flow

```text
Edit draft
  -> resolve and freeze DependencyLock
  -> select versioned environment binding
  -> validate references, policy, and provider capability
  -> perform configuration preflight in the target environment
  -> submit release review
  -> collect required approvals
  -> publish to a channel with a rollout rule
  -> append tamper-evident audit event
```

Validation includes:

- Referenced model and capabilities are active and organization-owned.
- The publisher may use and delegate each referenced resource.
- Required credentials exist without reading their plaintext.
- Runtime profile and tool policies are compatible.
- Input schema, limits, and fallback model policy are valid.
- No forbidden environment variable, path, or network target is embedded.
- Every dependency digest and deployment binding version is resolvable.
- The target execution provider can enforce all requested isolation controls.
- The author and approver satisfy the configured separation-of-duties rule.

Release states are:

```text
draft -> review_requested -> approved -> canary -> active -> deprecated
                       |          |          |          `-> rolled_back
                       `-> rejected          `-> halted
```

Submitting for review freezes that candidate. A rejection records reasons and
creates a new editable draft rather than reopening the reviewed snapshot.
Approval policies can require Agent owner review, Security Admin review for
dangerous capabilities, Resource Admin review for new dependencies, and two
distinct approvers for production.

Canary rollout targets explicit groups or a deterministic percentage keyed by
user/conversation ID. The platform compares error, latency, denial, and cost
guardrails before promotion. Rollback atomically repoints the release channel
to a previously approved tuple of Agent version, dependency lock, and binding
version. It never mutates historical Runs or interrupts active Runs unless a
Security Admin performs an audited emergency revocation.

Withdrawal prevents new Runs. Existing conversations either remain pinned,
are forced to upgrade through a compatibility-checked branch, or are blocked,
according to the release policy.

Existing conversations remain pinned to their starting release tuple by
default. Starting a new conversation resolves the Agent's default authorized
release channel. An explicit upgrade action can create a new conversation
branch after compatibility checks.

### 10.1 Approval Workflows

Approval policy is versioned and can apply to release publication, dangerous
tool use, production environment binding, credential administration, quota
increase, audit retention reduction, and break-glass access. A policy defines
required roles, distinct-actor count, whether the requester may approve,
expiry, escalation target, and notification channel.

Approval state is `pending`, `approved`, `rejected`, `expired`, or `canceled`.
Any material change to the target invalidates pending approvals. Rejection and
expiry leave the protected action unapplied. Notifications contain only
sanitized metadata and a link that requires fresh authorization; email or chat
actions cannot approve directly.

## 11. Run State Machine

The canonical state of the current attempt, projected to its logical Run, is:

```text
queued -> preparing -> running -> finalizing -> succeeded
                         |             `-> failed
                         |-> awaiting_approval -> running
                         |-> canceling -> canceled
                         |-> failed
                         `-> timed_out
```

Terminal states are `succeeded`, `failed`, `canceled`, and `timed_out`.
Transitions use compare-and-set updates so duplicate worker messages cannot
move a terminal Run back to an active state.

Each retry creates a new attempt linked to the original Run. Historical events
are not overwritten. A request idempotency key prevents accidental duplicate
Run creation, while an execution attempt ID prevents late events from an old
attempt from affecting the new one.

The queue job can additionally become `dead_lettered`; this is not a Run state.
The associated Run attempt remains `failed` with a stable reason and a link to
the dead-letter record. This distinction keeps product lifecycle independent
from queue implementation.

### 11.1 Run Commands

Run commands are explicit application operations, not one open-ended control
payload:

- `request_cancel` requests cooperative cancellation and is available to an
  authorized owner or Operator while the current attempt is active.
- `force_terminate` is a separate high-risk permission, requires a reason, and
  asks the execution provider to kill the current sandbox after policy checks.
- `pause` and `resume` are exposed only when both execution-provider and runtime
  capability discovery report support; otherwise the API returns
  `capability_not_supported` and the UI does not imply availability.
- `retry` is a Runs application command that creates a linked attempt after
  terminal-state and effect-ledger validation. It is never sent to an active
  attempt as a control message.
- Approval decisions use the Approval API with its own role, separation-of-
  duties, expiry, MFA, and audit rules.

Every command receives a UUIDv7 idempotency key scoped to actor, Run, operation,
and current attempt. The command row durably records `accepted`, `delivered`,
`acknowledged`, `completed`, `rejected`, or `expired`, including stable failure
codes and audit correlation. An HTTP acknowledgement means the command was
persisted, not that the sandbox has already completed it; clients reconcile the
Run snapshot and command receipt until terminal status.

## 12. Run Data Flow

1. The API authenticates the caller and authorizes Agent use.
2. It resolves the published version, dependency lock, and environment binding,
   validates inputs and quotas, reserves budget, and creates the Run plus
   transactional-outbox job in one database transaction.
3. A worker leases the job and changes the state to `preparing`.
4. The worker prepares isolation, opens the conversation through the session
   broker at the pinned base entry/version, and obtains short-lived secrets.
5. The worker starts Pi and changes the state to `running`.
6. Pi events pass classification, authorization, secret scanning, size limits,
   and redaction; accepted events are assigned a sequence and appended to
   `run_events` before broadcast.
7. Event clients page visible history to a durable snapshot watermark and then
   subscribe after its opaque cursor. A disconnect affects only delivery, not
   execution.
8. Completed Pi messages, tool results, compaction, labels, and navigation are
   appended immediately as typed `session_entries` through the broker.
9. The worker enters `finalizing`, stores usage and artifacts, verifies the
   active conversation version, and only then writes the terminal event/state.
10. The worker revokes its run token and removes the temporary workspace.

### 12.1 Event History and Live Delivery

Event history and SSE use one committed PostgreSQL source and a race-free
bootstrap protocol:

1. `GET /runs/{id}` returns the authorized Run snapshot, state version, current
   attempt, capabilities, and a durable visible-event high-watermark cursor.
2. The client cursor-pages historical visible events up to that watermark.
3. It opens SSE with `after=<highWatermark>`; the server first queries committed
   rows after the cursor and then continues delivering newly committed rows.
4. The client deduplicates by globally unique event ID and verifies cursor
   continuity. A reported gap pauses display advancement, backfills from the
   last accepted cursor, and resumes only after continuity is restored.
5. On reconnect, browser `online`/`visibilitychange`, authorization-context
   change, or terminal-event ambiguity, the client refetches the Run snapshot
   before resuming from its last accepted cursor.

`EventCursor` is an opaque, signed encoding of Run, visibility projection,
ordering position, and policy version. Raw storage sequence is not a browser
contract because restricted events may be filtered. Cursors expire according
to online event retention; an expired cursor returns a stable reset response
and a fresh snapshot watermark. Repeated delivery is allowed, loss is not.

History endpoints use forward and backward cursor pagination with bounded page
size. The UI window-renders long histories and defaults repetitive process,
token, and tool events into collapsible groups while retaining search and
individual event inspection. It never mounts thousands of event rows at once.

### 12.2 PostgreSQL Session Graph

PostgreSQL stores the Pi session tree directly. `session_entries` is append-only
and contains `id`, `organization_id`, `conversation_id` of origin,
`parent_entry_id`, `entry_type`, `schema_version`, `sequence`, `payload_jsonb`,
`classification`, `run_id`, `created_at`, and an integrity hash. Large binary
or generated content is referenced through an authorized Artifact; it is never
embedded in the entry payload.

The state authority is unambiguous:

| State | Authority | Derived copy |
| --- | --- | --- |
| Identity, grants, Agent/release metadata | PostgreSQL | None |
| Run/attempt state, leases, approvals, effects | PostgreSQL | Metrics/search |
| Ordered live delivery and policy decisions | PostgreSQL `run_events` | SSE |
| Pi message tree, tools, labels, navigation, compaction | PostgreSQL `session_entries` | Sanitized search projection |
| Conversation base, active leaf, state version | PostgreSQL `conversations` | None |
| Artifact bytes | Content-addressed object storage | PostgreSQL metadata/checksum |

Each broker append runs one short transaction:

1. Validate organization, operation capability, active Run lease, conversation
   lock owner, expected state version, entry schema, parent, size, and DLP.
2. Insert the immutable entry with a server-generated ID and integrity hash.
3. Compare-and-set the conversation active leaf and increment state version.
4. Insert the corresponding completed-entry `RunEvent` and outbox record when
   the entry is visible to the Run stream.
5. Commit and return the new entry ID/version. A failed transaction changes
   neither the session tree nor its visible event projection.

A path to the active leaf is resolved from immutable parent links. Context
building applies Pi's typed compaction rules to that path. Streaming token
deltas remain in `run_events`; only complete, schema-valid Pi entries enter the
session graph. A completed-entry event links to its `session_entry_id`, so a
projection verifier can detect or repair a missing search/event projection
without modifying canonical conversation history.

Branch navigation compare-and-sets `active_leaf_entry_id` and records the typed
leaf/navigation entry required by the Pi session contract. A fork creates a new
conversation with a `conversation_bases` reference to the authorized source
entry; immutable ancestors are shared rather than copied. New entries record
the forked conversation as origin. Access queries expose only ancestors
reachable from an authorized conversation, and retention cannot delete a node
while another conversation base or descendant references it.

One active Run owns the conversation mutation lease. Concurrent prompts queue
behind it or explicitly fork; they cannot append against a stale leaf. A
verifier checks parent existence, organization consistency, schema versions,
entry hashes, active-leaf reachability, Run links, and projection links. Invalid
graphs are quarantined and never repaired by inventing message content.

## 13. Tool Policy and Approval

Each tool capability and, where supported, each operation has one policy:

- `allow`: execute without human approval within configured limits.
- `deny`: reject before execution.
- `require_approval`: pause and create an approval request.

Approval requests contain only a sanitized tool name, parameter summary, risk,
target resource, and expiry. The full secret-bearing invocation is not sent to
the browser. Only an authorized approver may decide. The decision, actor,
reason, time, and eventual tool outcome are audited.

An approval timeout rejects the operation. If the worker disappears while an
operation is waiting, the platform marks the attempt failed rather than
replaying a potentially side-effecting call.

### 13.1 Runtime Policy Enforcement

Dispatch authorization is necessary but not sufficient. The worker supervisor
acts as a policy-enforcement point for every model call, tool call, file broker
operation, secret fetch, artifact read/write, and outbound connection. It sends
the current actor, organization, Run, Agent/release, requested capability,
sanitized arguments, target classification, quota state, and lease state to a
local policy decision service backed by the signed policy snapshot and current
revocation data.

Each allowed operation receives a single-purpose capability token bound to the
attempt, operation, target, limits, and short expiry. Brokers reject raw
runtime requests without that token. Revocation, expired lease, canceled Run,
changed security policy, or exhausted quota blocks the next operation even if
the Run was authorized at dispatch. Policy decisions and denials become
restricted `RunEvent` and audit records.

### 13.2 Side-Effect and Idempotency Contract

Every Tool version declares one effect class:

- `read_only`: no externally visible mutation.
- `idempotent`: accepts a platform idempotency key and guarantees repeat safety.
- `transactional`: exposes prepare/commit/abort or a verifiable receipt.
- `non_idempotent`: may mutate external state and cannot be auto-retried.

The platform key is derived from organization, Run, attempt, tool-call ID,
Tool version, and logical operation. The `tool_effects` ledger moves through
`planned`, `authorized`, `dispatched`, `acknowledged`, and `completed` with an
external receipt when available. An ambiguous state at or after `dispatched`
blocks automatic retry unless the Tool contract can query the external outcome
by idempotency key.

Arbitrary coding-agent shell commands are always `non_idempotent` from the
platform's perspective. They run only in the disposable workspace. Changes to
an enterprise repository or host filesystem are exported as a patch/artifact
and applied by a separate authorized broker or user workflow; the sandbox does
not mount a mutable host checkout.

## 14. Failure Handling

Stable error categories include:

- `authorization_denied`
- `quota_exceeded`
- `configuration_invalid`
- `credential_unavailable`
- `model_auth_failed`
- `model_rate_limited`
- `model_context_overflow`
- `tool_denied`
- `tool_failed`
- `approval_expired`
- `worker_lost`
- `execution_timed_out`
- `artifact_commit_failed`
- `platform_unavailable`

Error payloads contain a safe user message, stable code, retryability, and a
correlation ID. Raw provider or tool errors are restricted diagnostic data.

Workers renew leases while active. When a lease expires, the control plane
marks the attempt `worker_lost`. Automatic retry is allowed only when the
platform can prove no external side effect began or the affected operation is
declared idempotent. Otherwise an operator must initiate a new attempt.

Cancellation first requests cooperative abort. After a configured grace
period, the execution provider terminates the process or container. Late
events from the terminated attempt are ignored.

Retry policy is versioned per error category and execution phase. It defines
maximum attempts, exponential backoff base/cap, jitter, and total retry window.
Model throttling may retry before a tool side effect; configuration, policy,
credential, and validation errors never retry automatically. A circuit breaker
temporarily stops dispatch to a failing provider or Tool version and surfaces
the condition in operations UI.

Initial maximums are explicit defaults, not hidden implementation behavior:

| Condition | Automatic retries | Default delay |
| --- | ---: | --- |
| Queue/database transient before execution | 5 | 2 s exponential, 2 min cap, jitter |
| Worker loss before runtime start | 2 | 10 s exponential, 2 min cap, jitter |
| Model rate limit before any side effect | 3 | Provider hint, otherwise 5 s exponential |
| Idempotent Tool with outcome lookup | 2 | Tool policy |
| Ambiguous/non-idempotent side effect | 0 | Operator review |
| Invalid config, authorization, credential, quota | 0 | Correct cause first |

## 15. Security Design

### 15.1 Identity

Production supports OIDC and reserves an adapter boundary for SAML. The first
Owner is created through a one-time deployment bootstrap flow. Open
registration is disabled. The application refuses production startup when the
development-only identity adapter is configured.

OIDC uses Authorization Code with PKCE, issuer/audience/nonce validation,
rotating signing-key discovery, and an explicit claim-to-organization/group
mapping. Browser sessions use opaque, hashed, revocable server-side sessions
in `Secure`, `HttpOnly`, `SameSite` cookies. Authentication strength and time
are recorded so sensitive actions can require recent MFA asserted by the IdP.
Membership disable, role change, IdP disable, or detected compromise revokes
affected sessions and stream subscriptions.

Session policy defines absolute and sliding expiry, idle timeout, permitted
concurrent sessions, and whether administrators may terminate other sessions.
Logout revokes the server row before clearing the cookie. Forced logout and
concurrent-session eviction publish a user-context invalidation so browser
queries and streams stop without waiting for cookie expiry.

### 15.2 Isolation

- General assistants have no shell or project filesystem by default.
- Every Run receives a fresh workspace and unique unprivileged UID. No Run can
  read another Run's workspace, temporary files, process namespace, or secrets.
- Coding assistants receive a copy-on-write snapshot or content-addressed input
  tree, never a mutable host project root. Declared reference mounts are
  read-only; writes remain in the Run overlay and leave only through the
  artifact/patch broker.
- Production execution uses an OCI container with CPU, memory, process, and
  duration limits.
- Containers run rootless with all Linux capabilities dropped, `no-new-
  privileges`, read-only base filesystem, bounded `tmpfs`, seccomp and
  AppArmor/SELinux policy, PID/user/mount/network namespaces, and no host,
  container-runtime socket, device, or cloud metadata mount.
- Network access defaults to denied and is granted by host or connector policy.
- Platform internal endpoints and cloud metadata addresses are denied.
- Worker service identities are scoped to assigned Runs.
- Plugins and language subprocesses execute inside the same sandbox constraints
  and cannot extend mounts, network policy, or environment variables.

The production startup check verifies that the OCI provider supports every
required control. Unsupported isolation is a deployment failure, not a warning.
Windows development can use local process mode, but that mode is not certified
for enterprise isolation.

### 15.3 Credential Exposure Controls

Model and connector credentials are preferably held by supervisor-side
brokers: the runtime sends a capability-authorized request, and the broker adds
the credential after policy and egress checks. Raw credentials are not exposed
to the model, shell, or general Agent process.

When a third-party CLI can operate only with an environment/file credential,
the platform must use a dedicated Tool adapter. It launches one allowlisted
subprocess with a minimal environment and ephemeral memory-backed credential,
captures bounded output through the redaction pipeline, and destroys the
credential immediately. Such an adapter is disabled until it has tests proving
scope, cleanup, rotation, and leakage controls. The unrestricted shell Tool
never inherits platform or provider credentials.

### 15.4 Application Security

- Organization filters are mandatory in service and repository calls.
- File APIs enforce organization, Agent, Run, and allowed-root checks.
- Markdown, tool output, and exported HTML are sanitized.
- Connector HTTP clients block SSRF through DNS/IP validation, redirect
  validation, protocol allowlists, and private-network policy.
- CSRF protection, secure cookies, origin validation, and rate limiting apply
  to state-changing endpoints.
- Sensitive fields use centralized redaction before logging or event storage.

SSE uses the authenticated, revocable browser session; external streaming APIs
use a short-lived bearer token scoped to one Run. Subscription creation checks
`run.read`, organization, artifact visibility, and event-classification
clearance. The server revalidates session/authorization version during
heartbeats and closes the stream on revocation.

Only `user_visible` sanitized event projections are sent over SSE. Restricted
diagnostic, audit-only, secret-bearing, oversized, and quarantined payloads are
excluded. Redaction and classification happen before database append, and raw
runtime buffers are discarded unless an explicit diagnostic policy stores an
encrypted restricted artifact.

### 15.5 Data Classification and Egress Control

Organizations define classification labels and policies for prompts, files,
tool output, model destinations, connectors, artifacts, and logs. Ingress
scanners identify configured secret patterns, credentials, regulated
identifiers, and classification markers. Egress brokers evaluate destination,
Agent, actor, data label, volume, and approval policy before model, connector,
artifact-download, or patch-export operations.

Policy can allow, redact, require approval, quarantine, or deny. Quarantined
content is unavailable to normal users and requires a Security Admin workflow.
Detection is defense in depth, not a guarantee; least-privilege mounts,
brokered credentials, network deny-by-default, and destination allowlists remain
the primary controls.

### 15.6 Tamper-Evident Audit

The application audit writer has insert-only permission; normal application and
administrator roles cannot update or delete audit rows. Each organization has
an ordered hash chain over a canonical event representation. Periodic chain
heads are signed with a dedicated audit key and exported with the event batch
to object-lock/WORM storage and, when configured, an external SIEM.

A verifier continuously checks sequence gaps, hashes, signatures, immutable
export receipts, and clock skew. Verification failure creates an out-of-band
alert. A database superuser can still alter PostgreSQL, so the external signed
checkpoint is the evidence that makes such alteration detectable. Audit-key
administration is separate from product and database administration.

The mandatory audit catalog covers authentication/session events; membership,
group, role, and policy changes; Agent drafts submitted for review; dependency
locks, environment bindings, release decisions, rollback, and withdrawal;
resource and credential lifecycle/access; Run admission/cancel/retry/terminal
outcome; tool policy decisions and effects; approvals; artifact access/export/
deletion; quotas and retention; configuration/migration; audit export; and all
break-glass or failed privileged operations.

### 15.7 Artifact Authorization

Artifacts inherit organization, Run, creator, Agent, classification, and
retention policy at creation. Default content access is limited to the creator
and principals with explicit Run/artifact permission; organization membership
alone grants no content access. Operators receive diagnostic access only for
granted Agents, while Auditors see metadata unless policy explicitly grants
content review.

Enterprise file and artifact APIs operate on opaque IDs through an
`ArtifactDataSource`; an enterprise request cannot submit an absolute or host
path. Metadata, directory-child, preview, and download requests each perform a
fresh authorization and DLP/approval decision.

Sensitive previews, quarantined-review workflows, and content requiring
immediate revocation use an authenticated control-plane proxy with bounded
streaming and HTTP Range support. Large, lower-risk downloads may receive a
short-lived signed URL scoped to the exact object key, immutable version,
method, response headers, and requesting grant. A URL never authorizes listing
or another object, and quarantine never produces a direct URL. Issuance and
proxied access are audited; object-store access logs are correlated where the
backend supports them. Run deletion does not immediately delete an artifact
under legal hold or shared reference; reference counting and retention state
determine disposal.

### 15.8 Retention and Deletion

Retention policy applies independently to session entries, run events,
attachments, artifacts, audit, and usage. Deletion is asynchronous and auditable. Audit
records follow a longer organization-configured retention period and cannot be
modified through normal application APIs.

The lifecycle is:

```text
active -> expired -> delete_pending -> objects_deleted
       -> rows_redacted_or_tombstoned -> deletion_verified
```

Legal hold blocks transition from `active` or `expired`. Active Runs and their
reachable session-entry ancestry are protected. A deletion job first freezes new references,
then deletes object versions, then redacts or removes permitted PostgreSQL
content while retaining minimal referential/audit tombstones. It records every
object/checksum and retries idempotently. A reconciler detects orphan objects,
missing objects, and metadata whose lifecycle diverges from storage. Backup
expiry follows the documented maximum residual-retention window; emergency
restore reapplies deletion tombstones before reopening service.

### 15.9 Quotas and Rate Limits

Quota dimensions include organization, user, group, Agent, release, model,
Tool, and credential. Meters include active/concurrent Runs, request rate,
model calls, input/output tokens, cost, wall time, CPU/memory class, artifact
storage, and outbound bytes.

Admission uses an atomic reservation against hard limits before Run creation.
Workers report incremental usage and release unused reservation at terminal
state. Soft limits alert and can require approval; hard admission limits reject
or queue new Runs with `quota_exceeded`. Hard per-Run token, duration, or egress
limits cooperatively stop the active Run, then hard-cancel after a grace period.
Quota changes are versioned, audited, and can require Security Admin approval.

The Usage and Quota module owns reservations, meters, immutable usage records,
the model-price catalog, and the cost ledger. Admission reserves hard-limit
capacity before the Run and outbox job are created. The model broker checks the
remaining reservation before every call and records provider-reported token
usage; workers report runtime, Tool, storage, and egress increments with stable
usage record IDs. Cost uses the immutable price-catalog revision pinned to the
Run, not today's mutable price.

A versioned policy chooses `reject`, bounded `queue`, or `stop` for each
over-limit condition. Model downgrade happens only when an approved Agent
policy explicitly names the fallback, and the selection is visible and audited.
Audit, quota, usage, and cost projections reference the same immutable usage
record IDs so their totals can be reconciled.

## 16. Observability

The platform emits OpenTelemetry traces, metrics, and correlated structured
logs through an OpenTelemetry Collector. The default private-deployment stack
uses a Prometheus-compatible metrics store and Alertmanager-compatible routing;
organizations may replace the storage/export backends without changing
instrumentation names or correlation fields.

Metrics include:

- Queue depth and age.
- Run queue time, duration, result, cancellation, and retry rate.
- Worker capacity, lease renewals, and heartbeat age.
- Model latency, provider errors, rate limits, tokens, and cost.
- Tool duration, failure rate, denials, and approvals.
- SSE subscriber count, reconnects, and delivery lag.
- Artifact upload latency and failure rate.

Logs carry `organization_id`, `agent_id`, `run_id`, `attempt_id`, `worker_id`,
and correlation ID. Prompt bodies, tool secrets, credentials, and full file
contents are excluded by default.

Tracing covers API, database transaction, queue lease, worker preparation,
model request, tool invocation, artifact commit, and terminal update. Run
Center exposes safe diagnostic summaries and correlation IDs, not raw secrets.

### 16.1 Service Objectives and Alerts

The production profile targets, measured monthly:

- 99.9% control-plane API availability, excluding announced maintenance.
- 99.9% successful durable Run admission when dependencies are healthy.
- 99.9% event-query/SSE availability for already committed events.
- No loss of acknowledged Run events or committed session entries.

External model and Tool availability is reported separately so provider
failure does not hide platform reliability. Initial paging conditions include:

- API 5xx above 2% for five minutes or p95 latency above two seconds.
- Oldest eligible queue job above two minutes with available worker capacity.
- Any unexpected worker loss, growing dead-letter count, or lease recovery loop.
- PostgreSQL replication/backup failure, connection saturation, or storage
  above 80%.
- Object-store commit failure above 1%, audit-chain/export verification failure,
  secret/key expiry, or DLP broker unavailable.
- Organization hard quota above 90% forecast or an unusual denial/egress spike.

Every alert has an owner, severity, dashboard, runbook, and tested escalation
route. SLO and thresholds are configuration with reviewed defaults, because
deployment size and provider latency vary.

## 17. Deployment Topology and Availability

The minimum production private-deployment topology is:

- Two or more Pi Web control-plane instances behind a health-checking load
  balancer.
- PostgreSQL with synchronous high-availability standby, automated failover,
  point-in-time recovery, and encrypted backups in a separate failure domain.
- A distributed MinIO deployment with versioning, integrity validation,
  encrypted transport/storage, and the deployment's required
  availability/replication class.
- Two or more Agent workers distributed across failure domains and supporting
  graceful drain during upgrade.
- A redundant reverse proxy/TLS endpoint and highly available SecretStore or
  KMS dependency.

The Web control plane is stateless apart from standard request caches. Any
instance can serve an API request or SSE reconnect. Worker capacity scales
independently. Database migrations run as a dedicated deployment step before
new application instances become active.

SSE does not require load-balancer stickiness: every Web instance authorizes
the viewer and reads committed visible events from PostgreSQL using opaque
cursors. Authorization, Run, command, and stream progress are never owned by
Web-process memory. Dispatch and expired-lease recovery run in a separate
scheduler deployment elected through the database, not in an arbitrary Web
instance. Worker heartbeats, leases, commands, acknowledgements, and recovery
decisions are durable, so control-plane failover cannot create an unrecorded
command or duplicate scheduler owner.

The baseline objective is RPO <= 5 minutes and RTO <= 60 minutes for a regional
platform failure; already committed PostgreSQL transactions have RPO 0 across
an in-region failover. Deployments with stricter requirements select stronger
database/object-store replication and document the resulting cost.

Failure behavior is explicit:

- Control-plane instance loss is handled by the load balancer; no in-memory
  session or Run ownership is required.
- Worker loss is handled by lease classification and never transfers a live
  sandbox blindly.
- PostgreSQL failover pauses new dispatch. Workers keep a bounded encrypted
  event spool for already in-flight output, stop issuing new model/tool
  operations as soon as lease renewal fails, and cannot report success until
  events are durably flushed.
- Object-storage failure leaves a Run in `finalizing`; finalization retries
  idempotently and cannot publish missing artifact metadata.
- SecretStore failure blocks preparation or the next credential operation; it
  does not fall back to cached global credentials.

Backups cover PostgreSQL, object versions, audit exports, configuration, and
key-recovery procedures. Restore drills run at least quarterly and verify
cross-store checksums, deletion tombstone replay, identity bootstrap, worker
reconnection, RPO, and RTO. A single-host development topology is supported but
does not claim these production availability properties.

## 18. Migration from Current Pi Web

Migration is incremental and preserves the existing local workflow while the
enterprise path is built:

1. Capture desktop/mobile and light/dark behavior baselines for the current
   `AppShell`, chat, tool calls, branches, file panel, and configuration flows.
2. Extract normalized presentation models and pure display reducers from
   `useAgentSession` without changing rendered local behavior. Keep
   `LocalSessionClient` separate from the enterprise Conversation, Run, event,
   and Artifact clients.
3. Extend the existing `AppShell` with a compact global top bar and make the
   sidebar route-specific context; add route-aware center content without
   creating another frontend application or duplicating chat presentation.
4. Add Agent Studio, Catalog, Run Center, Resource Center, Team, Audit, and
   Settings routes in the same App Router and visual system.
5. Reuse chat/message presentation and low-level tree/form primitives. Add
   enterprise-specific paginated branch/file controllers and versioned
   resource forms instead of adding mode branches to local data-bound widgets.
6. Move enterprise execution to workers using Runtime Stage A: Agent Harness,
   approved coding tools, `BrokeredSessionStorage`, and the versioned session
   broker. Full Coding Agent compatibility remains the post-release Stage B.
7. Disable unrestricted local auth, settings, filesystem, package, and
   in-process session routes in enterprise mode.

Deployment mode is explicit and validated at build and startup as
`PI_DEPLOYMENT_MODE=local|enterprise`. Local APIs live under `/api/local/*` and
enterprise APIs under `/api/enterprise/v1/*`. Every local route calls a shared
mode guard before parsing input or touching filesystem/configuration state;
enterprise mode returns `404` for that namespace. Hiding UI is not a security
control.

Enterprise modules cannot import `platform/local`, local Pi configuration,
filesystem sessions, `rpc-manager`, or unrestricted file/worktree helpers.
Folder/package exports, lint rules, architecture tests, and the production
bundle check enforce that dependency direction. Local mode is a developer
feature and does not claim enterprise isolation. Enterprise startup requires
database, identity, secret, artifact, and worker configuration and refuses all
legacy session paths.

Legacy local conversation data is not migrated into the enterprise platform.
There is no enterprise import endpoint or compatibility storage mode. Local and
enterprise conversations are separate products; enterprise users start new
PostgreSQL-backed conversations after their Agents and resources are approved.
There is no bidirectional data synchronization between modes. Rollback means
deploying the previous enterprise application version inside its documented
schema-compatibility window or restoring enterprise backups; enterprise data
is never downgraded into local mode. Each delivery phase defines forward-only
migrations, application compatibility, feature-flag disablement, and an
operator rollback drill before promotion.

## 19. Testing Strategy

### 19.1 Unit Tests

- OIDC claim mapping, session revocation, permission evaluation, resource
  scoping, explicit denials, and separation of duties.
- Agent content immutability, dependency locks, environment bindings, release
  state/rollout rules, and rollback selection.
- Run, queue-job, approval, effect-ledger, artifact, and deletion state
  transitions, including stale-attempt rejection.
- Quota reservation/accounting, retry classification/backoff, redaction, DLP
  decisions, and stable error mapping.
- Audit canonicalization, hash chaining, checkpoint signing, and verification.
- Versioned session-broker append-and-advance, move-leaf, branch, fork,
  compaction, conflict, and retry behavior, including the
  `BrokeredSessionStorage` mapping used by Agent Harness.

### 19.2 Contract Tests

- Separate contract suites for `EnterpriseConversationClient`,
  `EnterpriseRunClient`, `EnterpriseArtifactClient`, and `LocalSessionClient`;
  no lifecycle-conformance test may imply semantic parity between them.
- Intent and command idempotency, request-hash conflict, Conversation/Run/
  attempt relationships, capability discovery, and asynchronous operation
  receipts.
- Event snapshot watermark, opaque cursor pagination, history-to-SSE handoff,
  duplicate/gap recovery, authorization projection, and expired-cursor reset.
- Golden and backward-compatibility fixtures for `RunEnvelope`, worker events,
  heartbeat, cancellation, approval, and protocol negotiation.
- Duplicate/out-of-order event and command handling, transactional outbox,
  command inbox, and stale state versions.
- A conformance suite shared by Local Process, OCI, and future execution
  providers, including required capability rejection.
- Runtime Stage A Agent Harness event normalization. Coding Agent RPC and
  extension compatibility fixtures are required only before enabling Stage B.
- Secret, file, network, artifact, and patch broker capability contracts.
- Content-addressed artifact commit and checksum behavior.
- Architecture tests for module imports, table/repository ownership, centralized
  authorization, API namespace guards, and absence of local modules from the
  enterprise production bundle.

### 19.3 Integration Tests

Use a real PostgreSQL instance and queue repositories with the Pi faux model:

- RLS with correct, missing, forged, and cross-organization transaction context.
- OIDC login/session revocation with a local test issuer.
- Draft validation, dependency resolution, environment binding, approval,
  canary, promotion, rollback, withdrawal, and version pinning.
- Run creation, leasing, execution, and terminal persistence.
- Concurrent queue leasing, lease expiry, advisory-lock failover, deadlock
  retry, exponential backoff, dead letter, and operator-created attempts.
- Browser disconnect during every history/SSE handoff step, opaque-cursor gap
  backfill, policy-version invalidation, and snapshot reconciliation.
- Conversation serialization and durable follow-up prompts.
- Session-graph branch/fork/compaction transactions, optimistic conflict,
  ancestry retention, projection reconciliation, and graph quarantine.
- Worker loss at every effect-ledger phase, cancellation, and permitted retry.
- Run-token expiry/revocation, brokered credential delivery, key rotation, and
  leakage scans across every persisted/output channel.
- Artifact grant, authenticated Range proxy, exact-object signed URL,
  revocation, quarantine, legal hold, reference-aware deletion, and cross-store
  reconciliation.
- Quota races, admission/model-call checks, reservation release, immutable
  price revision, usage/cost reconciliation, soft/hard thresholds, and
  in-flight stop.

### 19.4 End-to-End Tests

- Role-specific navigation and action visibility.
- Cross-role Agent creation, review, publish, grant, and use.
- Playground chat and production catalog conversation.
- Run Center live view, artifacts, cancel, retry, and approvals.
- Audit filters/saved searches/masked exports and approval diff, reason, MFA,
  no-self-approval, expiry, and notification deep links.
- Audit entries for every security-relevant operation.
- Identity, Security, Resource, Operator, and Auditor separation-of-duties
  journeys, including two-person and break-glass workflows.
- Coding and general Agent conversations using the same PostgreSQL session port,
  including branch navigation, fork, compaction, restart, and export.

### 19.5 Frontend Regression Tests

- Component tests for normalized messages, submitting/queued/durable states,
  streaming updates, thinking, tool calls/results, command receipts, approvals,
  notices, and paginated branch navigation.
- Route and authorization tests for the global top bar, route context panel,
  deep links, operation capabilities, server-masked fields, organization
  switching, expired/forced-out sessions, and revoked streams.
- Visual regression screenshots for the existing workspace and every new
  enterprise route at desktop/mobile widths in light/dark themes.
- Layout checks that left/right panel transitions, chat input, long text,
  tables, forms, dialogs, file previews, and live status never overlap or cause
  unexpected resizing.
- End-to-end coverage for the Runtime Stage A capabilities declared by each
  Agent version: new Conversation, reconnect, steering/follow-up, cancellation,
  compact, fork, authorized file browsing/preview, attachments, model selection,
  approved Skills/plugins, completion sound, and mobile drawers. The suite must
  not imply compatibility with undeclared local Coding Agent RPC or extension
  behavior.
- Mobile management E2E and visual tests for prioritized list rows, filter/sort
  sheets, Agent Studio steps, virtualized timelines, approval decisions, sticky
  actions, and explicit desktop-required states.
- A bundle/runtime check proving enterprise pages are delivered by the same
  `pi-web-main` Next.js application and reuse the normalized chat modules.

### 19.6 Security and Failure Tests

- Cross-organization IDOR attempts.
- Path traversal and unauthorized artifact access.
- Direct calls to every `/api/local/*` route in enterprise mode and architecture
  checks for enterprise-to-local imports.
- Stored and reflected XSS through prompts, model output, tools, and exports.
- Connector SSRF, redirect, and DNS rebinding cases.
- Secret leakage scans across responses, session entries, events, logs, and
  artifacts.
- Sandbox escape regression cases: host mounts, runtime socket, devices,
  capabilities, root, namespaces, resource exhaustion, and unauthorized egress.
- Web restart, worker kill, duplicate delivery, stale events, database failover,
  object-store outage, SecretStore outage, full event spool, and finalization
  recovery.
- Audit row mutation/gap/signature/export tampering and out-of-band alerting.
- Load tests for API/SSE connections, queue contention, event volume, worker
  saturation, and noisy internal organizations.

Database migrations are tested against a snapshot from the previous released
schema. Migrations are forward-only in production; recovery uses backups and a
documented application rollback compatibility window.

Quarterly restore tests verify the declared RPO/RTO. Security tests run against
the OCI production profile; passing Local Process tests cannot certify
enterprise isolation.

## 20. Delivery Phases

### Phase 0: Runtime and Engineering Foundation

- Choose and implement one reproducible package/build topology so `pi-web-main`,
  workers, and tests consume the intended `pi-main` source or immutable package
  artifacts instead of an unrelated registry version.
- Package the worker as an independent deployment artifact and pin its Pi
  packages, worker protocol, runtime profile, and tool digests.
- Prove Runtime Stage A with Agent Harness, the approved coding tool set,
  `BrokeredSessionStorage`, atomic expected-version conflicts, and normalized
  events in a restart/failure test harness.
- Establish PostgreSQL migrations and disposable test databases, browser E2E and
  visual baselines, architecture/bundle checks, and worker integration tests.
- Exit gate: a minimal coding Run survives Web and worker restart, rejects a
  stale Conversation version without partial persistence, and is built from the
  same pinned `pi-main` artifacts in development, CI, and the worker image.

### Phase 1: Platform Foundation

- Extend the existing `AppShell` with the global top bar, route-specific left
  context, and route content while preserving the current workspace behavior.
- Extract display reducers, keep `LocalSessionClient` local-only, define the
  three enterprise clients, and lock in local UI regression baselines.
- OIDC/bootstrap identity, revocable sessions, and claim mapping.
- Organization, membership, group, separated roles, permission evaluator, and
  PostgreSQL RLS.
- PostgreSQL access layer, module boundaries, transaction/outbox kernel, and
  tamper-evident audit chain/export.
- Enterprise-mode configuration and route protection.
- Exit gate: enterprise startup rejects local namespaces/imports, identity and
  RLS security suites pass, the local UI baseline is unchanged, and rollback to
  the last compatible pre-release snapshot is rehearsed against its migrations.

### Phase 2: Agent Studio

- Agent and AgentVersion lifecycle.
- Structured Build view, versioned resource registry, dependency lock, and
  environment/deployment binding.
- Draft Playground using the existing Pi Web chat, message, tool, branch, and
  file presentation primitives through enterprise-specific controllers.
- Version validation and preflight.
- Exit gate: a developer can author and test a draft using only authorized,
  versioned resources; field masking, paginated trees, and mobile Studio tests
  pass, and incomplete Studio features can be disabled without data rollback.

### Phase 3: Execution Plane

- Durable PostgreSQL queue and worker leases.
- Versioned worker protocol, recovery/dead-letter scheduler, effect ledger, and
  execution-provider conformance contract.
- Productionize Runtime Stage A Agent Harness, approved coding/general tool
  profiles, the versioned session broker, and normalized events.
- Snapshot/history/SSE cursor handoff, run-time policy brokers, state machine,
  PostgreSQL session graph, and artifact persistence.
- Exit gate: a Conversation with multiple Runs survives Web/worker restarts,
  idempotency and command receipts pass fault injection, and failed rollout can
  drain workers before the prior compatible control-plane version is restored.

### Phase 4: Publishing and Operations

- Release approval, canary, promotion, rollback, withdrawal, and Agent Catalog.
- Resource grants and member conversations.
- Run Center, cancellation, retry, tool approvals, usage, and quotas.
- Artifact policy and lifecycle.
- Administrative health and audit views.
- Exit gate: canary/rollback, separated approvals, Run operations, audit export,
  quota/cost reconciliation, and artifact access pass role-specific E2E tests.

### Phase 5: Production Hardening

- OCI execution provider and network policy.
- Secret/file/network/egress brokers, DLP, key rotation, and deletion workers.
- Security, failure, load, high-availability, backup, restore, and RPO/RTO
  verification.
- SLO dashboards, alerting, audit verification, and operational runbooks.
- Private-deployment and upgrade documentation.
- Exit gate: production OCI security, HA/load, backup/restore, deletion,
  upgrade/rollback, and SLO/RPO/RTO drills pass with signed evidence.

### Post-Release Runtime Stage B: Full Coding Agent Compatibility

- Complete the asynchronous `CodingSessionPort` and remove concrete enterprise
  dependencies on `SessionManager` from `AgentSession`, runtime switching,
  export, and extension APIs.
- Pass differential compatibility tests for every RPC command, extension
  capability, navigation, compaction, export, and event behavior claimed by the
  Stage B profile.
- Run Stage A and Stage B workers behind the same versioned worker, broker,
  policy, event, artifact, and control-plane contracts during controlled canary
  rollout.
- Exit gate: Stage B meets all first-release security, durability, concurrency,
  failure, and observability criteria and can be disabled without changing or
  migrating Stage A Runs.

Each phase must leave existing verified behavior usable. A phase is not
complete when only pages exist; its server authorization, persistence,
operational failure paths, and tests must also be complete.

## 21. First-Release Acceptance Criteria

The first enterprise release is accepted only when all of the following are
demonstrated in the production OCI deployment profile:

The accepted coding runtime is Runtime Stage A. Full Coding Agent RPC, local
resource-loader, extension, import/export, and exact local session-behavior
compatibility are explicitly outside the first-release acceptance boundary.

1. Production authentication has no open registration and creates the first
   Owner through a one-time bootstrap.
2. Role changes and revocation terminate affected sessions/streams, and
   separated admin roles cannot approve their own protected changes.
3. RLS plus service authorization prevents cross-organization access in API,
   SSE, artifact, queue, worker, secret, audit, and object-store paths.
4. Developers can create and test an Agent, pin content/dependencies, bind an
   environment, obtain required approvals, canary, promote, roll back, and
   withdraw without mutating historical versions or Runs.
5. Members see and use only granted published Agents and artifacts.
6. A published version runs independently of the initiating browser and Web
   process.
7. Browser or Web restart does not lose Run progress; authenticated clients
   reconcile a Run snapshot, page history to its opaque high-watermark cursor,
   and resume SSE without loss or duplicate rendering.
8. The worker protocol rejects incompatible workers, duplicate commands,
   duplicate/out-of-order events, and stale attempts without corrupting state.
9. Worker or database failure produces a deterministic recoverable/terminal
   state and never blindly repeats an unverified side effect.
10. Coding Runs cannot access another Run, the host filesystem/runtime socket,
    undeclared network destinations, or platform service credentials.
11. Every tool, file, secret, artifact, and egress operation receives a current
    policy decision and operation-scoped capability.
12. Operators can inspect, cancel, and safely retry authorized Runs; queue
    recovery, backoff, dead letter, and circuit breakers are observable.
13. Release, sensitive Tool, credential, quota, retention, and break-glass
    approvals are authorized, expiring, separated, and audited.
14. Historical Runs retain their immutable Agent/dependency/binding tuple,
    session entries, events, effects, usage, and artifact references according to
    retention policy.
15. PostgreSQL session branching, fork, navigation, and compaction remain
    consistent under concurrency and injected database failures, with
    reconciliation for every defined projection divergence.
16. Platform-managed credentials do not appear in plaintext business records,
    versions, responses, session entries, events, logs, or artifacts; configured DLP
    policies detect and govern other credential-like content.
17. DLP and egress policy can allow, redact, approve, quarantine, or deny
    classified content before external transfer.
18. Audit chains, signed checkpoints, WORM exports, and tamper alerts verify
    independently from normal product administration.
19. Retention, legal hold, deletion, backup-expiry tombstones, and artifact
    references are verified across PostgreSQL and object storage.
20. Organization/user/Agent/model quotas reserve atomically, check before model
    calls, meter in flight, reconcile immutable usage/cost IDs against the
    pinned price revision, and enforce documented soft/hard outcomes.
21. Enterprise startup rejects any configuration or import that would instantiate
    the legacy file `SessionManager`; Stage A coding and general Agent profiles
    pass the versioned session-broker conformance suite without creating a
    session file.
22. Metrics, logs, traces, health checks, alerts, backup, restore, rolling
    upgrade, and declared SLO/RPO/RTO procedures are verified.
23. Enterprise pages run inside the existing `pi-web-main` App Router and
    preserve verified desktop/mobile, light/dark, chat, tool-call, branch,
    file-viewer, attachment, and responsive panel behavior without a duplicate
    frontend or chat implementation.
24. Enterprise mode returns `404` from every guarded local API before input
    parsing and its production bundle cannot import local sessions, config,
    filesystem, package management, `rpc-manager`, or worktree helpers.
25. Catalog start atomically creates a Conversation and initial Run; subsequent
    turns produce one Run each; fork creates a new Conversation; retry creates
    a linked attempt; UUIDv7 replay and conflict behavior is fault-tested.
26. Long Run histories are cursor-paginated, virtualized, gap-recoverable, and
    authorization-filtered without exposing raw internal sequences.
27. Enterprise file/artifact viewers never receive a host path; proxy and
    signed-URL access enforce exact-object authorization, revocation, Range,
    DLP, retention, and audit rules.
28. Enterprise Skills/plugins are immutable, signed/scanned dependencies that
    run only in the OCI sandbox; the first release executes no downloaded
    third-party browser JavaScript.
29. Desktop and mobile workflows verify global navigation, route-specific
    context, Agent Studio, Run/audit timelines, masked audit export, and
    reason/MFA-gated approvals without silently hidden management actions.

## 22. Deferred Follow-Up Projects

After the first release, independent design cycles can address:

- Managed knowledge bases and permission-aware retrieval.
- Scheduled and event-triggered automation.
- Visual workflows and multi-agent orchestration.
- External API keys and service accounts for Agent invocation.
- Multi-tenant SaaS isolation and billing.
- Agent marketplace, evaluation suites, and staged promotion environments.
- Dedicated message broker or event store when measured load requires it.
