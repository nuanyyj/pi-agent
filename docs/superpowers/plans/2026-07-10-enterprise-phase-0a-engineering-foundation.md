# Enterprise Phase 0A Engineering Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reproducible `pi-web-main` workspace that builds an independent Runtime Stage A worker from pinned Pi packages, validates its protocol and tool boundary, and provides PostgreSQL, MinIO, unit-test, architecture-test, and browser-regression foundations.

**Architecture:** Keep the existing Next.js application at the repository root and add two npm workspace packages: a runtime-neutral enterprise protocol package and an independent worker package. Runtime Stage A composes `AgentHarness` with an explicit coding-tool allowlist; it does not instantiate `AgentSession`, `SessionManager`, or the Coding Agent RPC runtime. Phase 0A proves package, process, protocol, infrastructure, and frontend-regression boundaries; the PostgreSQL versioned session broker is implemented in the separate Phase 0B plan.

**Tech Stack:** Next.js 16.2.9, React 19, TypeScript 5.9.3, Node.js 22.19+, npm workspaces, Pi packages 0.80.6, TypeBox 1.1.38, Vitest 4.1.9, Playwright 1.55.0, PostgreSQL 17.6, MinIO, Docker Compose.

---

## Scope And Preconditions

This plan includes:

- Exact Pi runtime dependency pinning and a version-policy check.
- `@pi-web/enterprise-protocol` and `@pi-web/enterprise-worker` workspace packages.
- Runtime Stage A tool selection and Agent Harness construction.
- A standalone worker preflight executable and container image.
- Local PostgreSQL and MinIO infrastructure with health checks and bucket bootstrap.
- Enterprise import-boundary checks and current Pi Web browser baselines.

This plan does not include:

- PostgreSQL session tables or `BrokeredSessionStorage`; those belong to Phase 0B.
- OIDC, RBAC, Agent Studio, durable queue processing, model credentials, or production Runs.
- Artifact authorization and lifecycle APIs; MinIO is only bootstrapped and health-checked here.
- Full Coding Agent RPC, extension, local resource-loader, or session behavior compatibility.

Execution preconditions:

- Restore the intended Git clone metadata before executing commit steps. The current workspace has no usable `.git`; do not create unrelated history with `git init`.
- Use Node.js 22.19 or newer.
- Install Docker Desktop or another Docker Compose v2 implementation for infrastructure and browser integration tasks.
- Run dependency installation with `--ignore-scripts`.

## File Map

### Repository Root

- Modify `package.json`: workspaces, pinned Pi dependencies, checks, and test scripts.
- Modify `package-lock.json`: generated npm workspace and exact dependency resolution.
- Modify `next.config.ts`: transpile the shared enterprise protocol package.
- Create `vitest.config.ts`: unit-test configuration.
- Create `playwright.config.ts`: browser baseline configuration.
- Create `compose.enterprise.yml`: PostgreSQL, MinIO, and MinIO bucket bootstrap.
- Create `.env.enterprise.example`: non-secret local configuration names.
- Create `scripts/check-enterprise-runtime-versions.mjs`: exact Pi version policy.
- Create `scripts/check-enterprise-imports.mjs`: AST-based forbidden-import check.
- Create `test/enterprise/`: repository-level version, architecture, and browser tests.

### Enterprise Protocol Package

- Create `packages/enterprise-protocol/package.json`: private workspace package manifest.
- Create `packages/enterprise-protocol/tsconfig.json`: ESM declaration build.
- Create `packages/enterprise-protocol/src/runtime.ts`: runtime profile and Run envelope schemas.
- Create `packages/enterprise-protocol/src/index.ts`: public exports only.
- Create `packages/enterprise-protocol/test/runtime.test.ts`: schema and parser tests.

### Enterprise Worker Package

- Create `packages/enterprise-worker/package.json`: independent worker manifest with exact Pi versions.
- Create `packages/enterprise-worker/tsconfig.json`: Node ESM build.
- Create `packages/enterprise-worker/src/coding-tools.ts`: approved Stage A tool registry.
- Create `packages/enterprise-worker/src/stage-a-runtime.ts`: Agent Harness factory.
- Create `packages/enterprise-worker/src/preflight.ts`: envelope and runtime capability validation.
- Create `packages/enterprise-worker/src/main.ts`: standalone preflight executable.
- Create `packages/enterprise-worker/src/index.ts`: public worker exports.
- Create `packages/enterprise-worker/test/`: tool, runtime, and executable tests.
- Create `packages/enterprise-worker/Dockerfile`: independent production artifact.
- Create `.github/workflows/enterprise-foundation.yml`: Phase 0A CI verification.

## Task 1: Bootstrap Workspaces And Test Tooling

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `next.config.ts`
- Create: `vitest.config.ts`
- Create: `packages/enterprise-protocol/package.json`
- Create: `packages/enterprise-protocol/tsconfig.json`
- Create: `packages/enterprise-protocol/src/index.ts`
- Create: `packages/enterprise-worker/package.json`
- Create: `packages/enterprise-worker/tsconfig.json`
- Create: `packages/enterprise-worker/src/index.ts`
- Test: `test/enterprise/workspace-smoke.test.ts`

- [ ] **Step 1: Add the workspace and exact toolchain dependencies**

Add `"workspaces": ["packages/*"]` to the root manifest. Pin the existing Pi dependencies to `0.80.6` without `^`, and add these exact root dev dependencies:

```json
{
  "@playwright/test": "1.55.0",
  "tsx": "4.22.1",
  "typescript": "5.9.3",
  "vitest": "4.1.9"
}
```

Add the following scripts while preserving existing scripts:

```json
{
  "typecheck": "tsc --noEmit && npm run typecheck --workspaces --if-present",
  "test:unit": "vitest run",
  "test:enterprise-imports": "node scripts/check-enterprise-imports.mjs",
  "check:runtime-versions": "node scripts/check-enterprise-runtime-versions.mjs",
  "check:enterprise": "npm run check:runtime-versions && npm run typecheck && npm run lint && npm run test:unit && npm run test:enterprise-imports",
  "build:enterprise-packages": "npm run build --workspace @pi-web/enterprise-protocol && npm run build --workspace @pi-web/enterprise-worker"
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
  },
});
```

Run:

```powershell
npm install --ignore-scripts
```

Expected: exit code 0 and the exact root toolchain dependencies are recorded in
`package-lock.json`. Workspace links are recorded after their manifests are
created in Step 4.

- [ ] **Step 2: Write the failing workspace smoke test**

```ts
import { describe, expect, it } from "vitest";
import { ENTERPRISE_PROTOCOL_VERSION } from "../../packages/enterprise-protocol/src/index.ts";
import { ENTERPRISE_WORKER_KIND } from "../../packages/enterprise-worker/src/index.ts";

describe("enterprise workspace", () => {
  it("exposes stable package identities", () => {
    expect(ENTERPRISE_PROTOCOL_VERSION).toBe(1);
    expect(ENTERPRISE_WORKER_KIND).toBe("stage-a-worker");
  });
});
```

- [ ] **Step 3: Run the smoke test and verify it fails**

Run:

```powershell
npx vitest run test/enterprise/workspace-smoke.test.ts
```

Expected: FAIL because the workspace source files or exports do not exist.

- [ ] **Step 4: Create the minimal workspace packages**

Use this protocol manifest:

```json
{
  "name": "@pi-web/enterprise-protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "typebox": "1.1.38" }
}
```

Use this worker manifest:

```json
{
  "name": "@pi-web/enterprise-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": { "pi-enterprise-worker": "./dist/main.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@earendil-works/pi-agent-core": "0.80.6",
    "@earendil-works/pi-ai": "0.80.6",
    "@earendil-works/pi-coding-agent": "0.80.6",
    "@pi-web/enterprise-protocol": "0.1.0"
  }
}
```

Use this `tsconfig.json` in both packages, changing only `outDir` and `rootDir` if their paths differ:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

Create the initial package exports:

```ts
// packages/enterprise-protocol/src/index.ts
export const ENTERPRISE_PROTOCOL_VERSION = 1 as const;
```

```ts
// packages/enterprise-worker/src/index.ts
export const ENTERPRISE_WORKER_KIND = "stage-a-worker" as const;
```

Add `transpilePackages: ["@pi-web/enterprise-protocol"]` to `next.config.ts`.

Run `npm install --ignore-scripts` again after both workspace manifests exist so
the lockfile records the workspace links and their exact dependencies.

- [ ] **Step 5: Run the smoke test and package type checks**

Run:

```powershell
npx vitest run test/enterprise/workspace-smoke.test.ts
npm run typecheck --workspace @pi-web/enterprise-protocol
npm run typecheck --workspace @pi-web/enterprise-worker
```

Expected: all three commands exit 0.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json next.config.ts vitest.config.ts packages/enterprise-protocol packages/enterprise-worker test/enterprise/workspace-smoke.test.ts
git commit -m "feat: add enterprise workspace foundation"
```

## Task 2: Define And Validate The Runtime Stage A Protocol

**Files:**

- Create: `packages/enterprise-protocol/src/runtime.ts`
- Modify: `packages/enterprise-protocol/src/index.ts`
- Test: `packages/enterprise-protocol/test/runtime.test.ts`

- [ ] **Step 1: Write the failing protocol tests**

```ts
import { describe, expect, it } from "vitest";
import { parseRunEnvelope } from "../src/runtime.ts";

const validEnvelope = {
  protocolVersion: 1,
  runtimeProfile: "agent-harness-v1",
  organizationId: "org-1",
  conversationId: "conversation-1",
  runId: "run-1",
  attempt: 1,
  workspaceRoot: "/workspace/run-1",
  toolNames: ["read", "grep"],
};

describe("parseRunEnvelope", () => {
  it("accepts the Stage A profile", () => {
    expect(parseRunEnvelope(validEnvelope)).toEqual(validEnvelope);
  });

  it("rejects an unknown runtime profile", () => {
    expect(() => parseRunEnvelope({ ...validEnvelope, runtimeProfile: "coding-agent-rpc" }))
      .toThrow("Invalid RunEnvelope");
  });

  it("rejects duplicate tools", () => {
    expect(() => parseRunEnvelope({ ...validEnvelope, toolNames: ["read", "read"] }))
      .toThrow("Duplicate tool: read");
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
npx vitest run packages/enterprise-protocol/test/runtime.test.ts
```

Expected: FAIL because `runtime.ts` does not exist.

- [ ] **Step 3: Implement the schema and parser**

```ts
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";

export const EnterpriseCodingToolNameSchema = Type.Union([
  Type.Literal("read"),
  Type.Literal("bash"),
  Type.Literal("edit"),
  Type.Literal("write"),
  Type.Literal("grep"),
  Type.Literal("find"),
  Type.Literal("ls"),
]);

export type EnterpriseCodingToolName = Static<typeof EnterpriseCodingToolNameSchema>;

export const RunEnvelopeSchema = Type.Object({
  protocolVersion: Type.Literal(1),
  runtimeProfile: Type.Literal("agent-harness-v1"),
  organizationId: Type.String({ minLength: 1 }),
  conversationId: Type.String({ minLength: 1 }),
  runId: Type.String({ minLength: 1 }),
  attempt: Type.Integer({ minimum: 1 }),
  workspaceRoot: Type.String({ minLength: 1 }),
  toolNames: Type.Array(EnterpriseCodingToolNameSchema),
}, { additionalProperties: false });

export type RunEnvelope = Static<typeof RunEnvelopeSchema>;

const validator = Compile(RunEnvelopeSchema);

export function parseRunEnvelope(input: unknown): RunEnvelope {
  if (!validator.Check(input)) {
    const first = Array.from(validator.Errors(input))[0];
    throw new Error(`Invalid RunEnvelope: ${first?.path ?? "root"} ${first?.message ?? "failed validation"}`);
  }
  const seen = new Set<string>();
  for (const toolName of input.toolNames) {
    if (seen.has(toolName)) throw new Error(`Duplicate tool: ${toolName}`);
    seen.add(toolName);
  }
  return input;
}
```

Export the runtime contract from `src/index.ts`:

```ts
export const ENTERPRISE_PROTOCOL_VERSION = 1 as const;
export * from "./runtime.js";
```

- [ ] **Step 4: Run protocol tests and type checks**

Run:

```powershell
npx vitest run packages/enterprise-protocol/test/runtime.test.ts
npm run build --workspace @pi-web/enterprise-protocol
npm run typecheck --workspace @pi-web/enterprise-protocol
```

Expected: tests pass, `dist/index.js` and `dist/index.d.ts` are generated, and the
type check exits 0.

- [ ] **Step 5: Commit**

```powershell
git add packages/enterprise-protocol
git commit -m "feat: define enterprise worker protocol"
```

## Task 3: Enforce Exact Pi Runtime Versions

**Files:**

- Create: `scripts/check-enterprise-runtime-versions.mjs`
- Test: `test/enterprise/runtime-versions.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing version-policy tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { validateRuntimeVersions } from "../../scripts/check-enterprise-runtime-versions.mjs";

test("accepts one exact Pi version", () => {
  assert.deepEqual(validateRuntimeVersions({
    web: { dependencies: { "@earendil-works/pi-ai": "0.80.6", "@earendil-works/pi-coding-agent": "0.80.6" } },
    worker: { dependencies: { "@earendil-works/pi-ai": "0.80.6", "@earendil-works/pi-agent-core": "0.80.6", "@earendil-works/pi-coding-agent": "0.80.6" } },
  }), []);
});

test("rejects ranges and mismatched versions", () => {
  const errors = validateRuntimeVersions({
    web: { dependencies: { "@earendil-works/pi-ai": "^0.80.6", "@earendil-works/pi-coding-agent": "0.80.6" } },
    worker: { dependencies: { "@earendil-works/pi-ai": "0.80.7", "@earendil-works/pi-agent-core": "0.80.6", "@earendil-works/pi-coding-agent": "0.80.6" } },
  });
  assert.equal(errors.length, 2);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
node --test test/enterprise/runtime-versions.test.mjs
```

Expected: FAIL because the checker does not exist.

- [ ] **Step 3: Implement the exact-version checker**

```js
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PI_PACKAGES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
];

export function validateRuntimeVersions(manifests) {
  const found = [];
  const errors = [];
  for (const [manifestName, manifest] of Object.entries(manifests)) {
    for (const packageName of PI_PACKAGES) {
      const version = manifest.dependencies?.[packageName];
      if (version === undefined) continue;
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        errors.push(`${manifestName}:${packageName} must use an exact version, received ${version}`);
      } else {
        found.push({ manifestName, packageName, version });
      }
    }
  }
  const versions = new Set(found.map((item) => item.version));
  if (versions.size > 1) {
    errors.push(`Pi packages must use one lockstep version: ${[...versions].sort().join(", ")}`);
  }
  return errors;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function main(rootDir) {
  const errors = validateRuntimeVersions({
    web: readJson(resolve(rootDir, "package.json")),
    worker: readJson(resolve(rootDir, "packages/enterprise-worker/package.json")),
  });
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(resolve(dirname(scriptPath), ".."));
}
```

- [ ] **Step 4: Run unit and repository checks**

Run:

```powershell
node --test test/enterprise/runtime-versions.test.mjs
npm run check:runtime-versions
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add package.json scripts/check-enterprise-runtime-versions.mjs test/enterprise/runtime-versions.test.mjs
git commit -m "feat: enforce pinned pi runtime versions"
```

## Task 4: Build The Approved Coding Tool Registry

**Files:**

- Create: `packages/enterprise-worker/src/coding-tools.ts`
- Create: `packages/enterprise-worker/src/stage-a-runtime.ts`
- Modify: `packages/enterprise-worker/src/index.ts`
- Test: `packages/enterprise-worker/test/coding-tools.test.ts`

- [ ] **Step 1: Write failing allowlist tests**

```ts
import { describe, expect, it } from "vitest";
import { createApprovedCodingTools } from "../src/coding-tools.ts";

describe("createApprovedCodingTools", () => {
  it("returns only requested tools in request order", () => {
    expect(createApprovedCodingTools(process.cwd(), ["read", "grep"]).map((tool) => tool.name))
      .toEqual(["read", "grep"]);
  });

  it("does not enable bash implicitly", () => {
    expect(createApprovedCodingTools(process.cwd(), ["read"]).map((tool) => tool.name))
      .toEqual(["read"]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
npx vitest run packages/enterprise-worker/test/coding-tools.test.ts
```

Expected: FAIL because `coding-tools.ts` does not exist.

- [ ] **Step 3: Implement tool selection and the Stage A factory**

```ts
// packages/enterprise-worker/src/coding-tools.ts
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createCodingTools,
  createFindTool,
  createGrepTool,
  createLsTool,
} from "@earendil-works/pi-coding-agent";
import type { EnterpriseCodingToolName } from "@pi-web/enterprise-protocol";

export function createApprovedCodingTools(
  cwd: string,
  toolNames: readonly EnterpriseCodingToolName[],
): AgentTool[] {
  const available = [
    ...createCodingTools(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ];
  const byName = new Map(available.map((tool) => [tool.name, tool]));
  return toolNames.map((name) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`Unsupported Stage A tool: ${name}`);
    return tool;
  });
}
```

```ts
// packages/enterprise-worker/src/stage-a-runtime.ts
import { AgentHarness, type AgentHarnessOptions } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { EnterpriseCodingToolName } from "@pi-web/enterprise-protocol";
import { createApprovedCodingTools } from "./coding-tools.js";

export interface StageARuntimeOptions {
  cwd: string;
  toolNames: readonly EnterpriseCodingToolName[];
  session: AgentHarnessOptions["session"];
  models: AgentHarnessOptions["models"];
  model: AgentHarnessOptions["model"];
  systemPrompt?: string;
}

export function createStageARuntime(options: StageARuntimeOptions): AgentHarness {
  return new AgentHarness({
    env: new NodeExecutionEnv({ cwd: options.cwd }),
    session: options.session,
    models: options.models,
    model: options.model,
    systemPrompt: options.systemPrompt,
    tools: createApprovedCodingTools(options.cwd, options.toolNames),
  });
}
```

Export both modules from `src/index.ts`.

- [ ] **Step 4: Run tests and type checks**

Run:

```powershell
npx vitest run packages/enterprise-worker/test/coding-tools.test.ts
npm run typecheck --workspace @pi-web/enterprise-worker
```

Expected: PASS and no TypeScript diagnostics.

- [ ] **Step 5: Commit**

```powershell
git add packages/enterprise-worker
git commit -m "feat: add stage a coding runtime"
```

## Task 5: Add The Standalone Worker Preflight Artifact

**Files:**

- Create: `packages/enterprise-worker/src/preflight.ts`
- Create: `packages/enterprise-worker/src/main.ts`
- Create: `packages/enterprise-worker/Dockerfile`
- Test: `packages/enterprise-worker/test/preflight.test.ts`

- [ ] **Step 1: Write failing preflight tests**

```ts
import { describe, expect, it } from "vitest";
import { preflightRun } from "../src/preflight.ts";

describe("preflightRun", () => {
  it("returns immutable runtime capabilities", () => {
    expect(preflightRun({
      protocolVersion: 1,
      runtimeProfile: "agent-harness-v1",
      organizationId: "org-1",
      conversationId: "conversation-1",
      runId: "run-1",
      attempt: 1,
      workspaceRoot: "/workspace/run-1",
      toolNames: ["read", "grep"],
    })).toEqual({
      protocolVersion: 1,
      runtimeProfile: "agent-harness-v1",
      toolNames: ["read", "grep"],
      workerKind: "stage-a-worker",
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
npx vitest run packages/enterprise-worker/test/preflight.test.ts
```

Expected: FAIL because `preflight.ts` does not exist.

- [ ] **Step 3: Implement preflight and executable input handling**

```ts
// packages/enterprise-worker/src/preflight.ts
import { parseRunEnvelope, type RunEnvelope } from "@pi-web/enterprise-protocol";

export function preflightRun(input: unknown) {
  const envelope: RunEnvelope = parseRunEnvelope(input);
  return Object.freeze({
    protocolVersion: envelope.protocolVersion,
    runtimeProfile: envelope.runtimeProfile,
    toolNames: Object.freeze([...envelope.toolNames]),
    workerKind: "stage-a-worker" as const,
  });
}
```

```ts
// packages/enterprise-worker/src/main.ts
#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { preflightRun } from "./preflight.js";

async function main(): Promise<void> {
  const envelopePath = process.env.PI_RUN_ENVELOPE_PATH;
  if (!envelopePath) throw new Error("PI_RUN_ENVELOPE_PATH is required");
  const input: unknown = JSON.parse(await readFile(envelopePath, "utf8"));
  process.stdout.write(`${JSON.stringify(preflightRun(input))}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
```

Create a reproducible multi-stage `Dockerfile` that installs from the lockfile
inside the image rather than copying host `node_modules`:

```dockerfile
FROM node:22.19.0-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/enterprise-protocol/package.json ./packages/enterprise-protocol/package.json
COPY packages/enterprise-worker/package.json ./packages/enterprise-worker/package.json
RUN npm ci --ignore-scripts
COPY packages/enterprise-protocol ./packages/enterprise-protocol
COPY packages/enterprise-worker ./packages/enterprise-worker
RUN npm run build:enterprise-packages
RUN npm prune --omit=dev --ignore-scripts

FROM node:22.19.0-bookworm-slim
WORKDIR /opt/pi-enterprise-worker
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/packages/enterprise-protocol/package.json ./node_modules/@pi-web/enterprise-protocol/package.json
COPY --from=build /src/packages/enterprise-protocol/dist ./node_modules/@pi-web/enterprise-protocol/dist
COPY --from=build /src/packages/enterprise-worker/package.json ./package.json
COPY --from=build /src/packages/enterprise-worker/dist ./dist
USER node
ENTRYPOINT ["node", "dist/main.js"]
```

- [ ] **Step 4: Build and exercise the executable**

Run:

```powershell
npm run build:enterprise-packages
npx vitest run packages/enterprise-worker/test/preflight.test.ts
docker build -f packages/enterprise-worker/Dockerfile -t pi-enterprise-worker:phase0a .
```

Expected: package builds and tests pass, and Docker produces the independent
`pi-enterprise-worker:phase0a` image from the checked-in lockfile.

- [ ] **Step 5: Commit**

```powershell
git add packages/enterprise-worker
git commit -m "feat: add enterprise worker preflight"
```

## Task 6: Bootstrap PostgreSQL And MinIO For Local Enterprise Development

**Files:**

- Create: `compose.enterprise.yml`
- Create: `.env.enterprise.example`
- Test: `test/enterprise/services-config.test.mjs`

- [ ] **Step 1: Write the failing configuration test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("enterprise compose pins PostgreSQL and MinIO and does not expose default secrets", async () => {
  const compose = await readFile(new URL("../../compose.enterprise.yml", import.meta.url), "utf8");
  assert.match(compose, /postgres:17\.6-alpine/);
  assert.match(compose, /minio\/minio:RELEASE\.2025-04-22T22-12-26Z/);
  assert.match(compose, /minio\/mc:RELEASE\.2025-04-16T18-13-26Z/);
  assert.doesNotMatch(compose, /minioadmin/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node --test test/enterprise/services-config.test.mjs
```

Expected: FAIL because `compose.enterprise.yml` does not exist.

- [ ] **Step 3: Create the pinned local infrastructure profile**

```yaml
services:
  postgres:
    image: postgres:17.6-alpine
    environment:
      POSTGRES_DB: ${PI_POSTGRES_DB}
      POSTGRES_USER: ${PI_POSTGRES_USER}
      POSTGRES_PASSWORD: ${PI_POSTGRES_PASSWORD}
    ports:
      - "127.0.0.1:${PI_POSTGRES_PORT:-5432}:5432"
    volumes:
      - pi-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20

  minio:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${PI_MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${PI_MINIO_ROOT_PASSWORD}
    ports:
      - "127.0.0.1:${PI_MINIO_API_PORT:-9000}:9000"
      - "127.0.0.1:${PI_MINIO_CONSOLE_PORT:-9001}:9001"
    volumes:
      - pi-minio-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 5s
      timeout: 3s
      retries: 20

  minio-init:
    image: minio/mc:RELEASE.2025-04-16T18-13-26Z
    depends_on:
      minio:
        condition: service_healthy
    environment:
      MINIO_ROOT_USER: ${PI_MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${PI_MINIO_ROOT_PASSWORD}
      MINIO_BUCKET: ${PI_MINIO_BUCKET}
    entrypoint:
      - /bin/sh
      - -ec
      - |
        mc alias set local http://minio:9000 "$${MINIO_ROOT_USER}" "$${MINIO_ROOT_PASSWORD}"
        mc mb --ignore-existing "local/$${MINIO_BUCKET}"
        mc anonymous set none "local/$${MINIO_BUCKET}"

volumes:
  pi-postgres-data:
  pi-minio-data:
```

Create `.env.enterprise.example` with names and non-production local values:

```dotenv
PI_POSTGRES_DB=pi_enterprise
PI_POSTGRES_USER=pi_enterprise
PI_POSTGRES_PASSWORD=replace-for-local-development
PI_POSTGRES_PORT=5432
PI_MINIO_ROOT_USER=pi_enterprise_local
PI_MINIO_ROOT_PASSWORD=replace-with-at-least-32-characters
PI_MINIO_API_PORT=9000
PI_MINIO_CONSOLE_PORT=9001
PI_MINIO_BUCKET=pi-artifacts
```

- [ ] **Step 4: Validate configuration and service health**

Run:

```powershell
node --test test/enterprise/services-config.test.mjs
docker compose --env-file .env.enterprise.example -f compose.enterprise.yml config --quiet
docker compose --env-file .env.enterprise.example -f compose.enterprise.yml up -d
docker compose --env-file .env.enterprise.example -f compose.enterprise.yml ps
```

Expected: tests pass, Compose config exits 0, PostgreSQL and MinIO become
healthy, and `minio-init` exits 0 after creating a private bucket. Stop services
after verification with `docker compose --env-file .env.enterprise.example -f
compose.enterprise.yml down`; do not add `-v` because that would delete
persistent data.

- [ ] **Step 5: Commit**

```powershell
git add compose.enterprise.yml .env.enterprise.example test/enterprise/services-config.test.mjs
git commit -m "feat: add postgres and minio development services"
```

## Task 7: Enforce Enterprise Import Boundaries With The TypeScript AST

**Files:**

- Create: `scripts/check-enterprise-imports.mjs`
- Test: `test/enterprise/import-boundaries.test.mjs`

- [ ] **Step 1: Write failing boundary tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { findForbiddenImports } from "../../scripts/check-enterprise-imports.mjs";

test("rejects enterprise imports of local runtime modules", () => {
  const failures = findForbiddenImports("platform/modules/runs/api/route.ts", `
    import { startRpcSession } from "@/lib/rpc-manager";
  `);
  assert.deepEqual(failures, ["@/lib/rpc-manager"]);
});

test("allows enterprise protocol imports", () => {
  assert.deepEqual(findForbiddenImports(
    "packages/enterprise-worker/src/main.ts",
    `import { parseRunEnvelope } from "@pi-web/enterprise-protocol";`,
  ), []);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
node --test test/enterprise/import-boundaries.test.mjs
```

Expected: FAIL because the checker does not exist.

- [ ] **Step 3: Implement AST-based import inspection**

```js
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const FORBIDDEN_PREFIXES = [
  "@/lib/rpc-manager",
  "@/lib/session-reader",
  "@/lib/file-access",
  "@/lib/worktree",
  "@earendil-works/pi-coding-agent/rpc-entry",
];

function isForbidden(specifier) {
  return FORBIDDEN_PREFIXES.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`));
}

export function findForbiddenImports(fileName, sourceText) {
  const kind = extname(fileName) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, kind);
  const failures = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (isForbidden(node.moduleSpecifier.text)) failures.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument) && isForbidden(argument.text)) failures.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return failures;
}

function collectTypeScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectTypeScriptFiles(path));
    if (entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

export function main(rootDir) {
  const roots = [];
  const platform = resolve(rootDir, "platform");
  try {
    roots.push(platform, ...readdirSync(resolve(rootDir, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("enterprise-"))
      .map((entry) => resolve(rootDir, "packages", entry.name)));
  } catch {
    return;
  }
  const failures = roots.flatMap((root) => {
    try {
      return collectTypeScriptFiles(root).flatMap((file) =>
        findForbiddenImports(file, readFileSync(file, "utf8")).map((specifier) => `${relative(rootDir, file)}:${specifier}`));
    } catch {
      return [];
    }
  });
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(fileURLToPath(new URL("..", import.meta.url)));
}
```

The exported function returns exact rejected module specifiers; the CLI prints
`file:specifier` and exits 1 when violations exist. Import syntax is inspected
through the TypeScript AST, not regular expressions.

- [ ] **Step 4: Run boundary tests and repository scan**

Run:

```powershell
node --test test/enterprise/import-boundaries.test.mjs
npm run test:enterprise-imports
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add scripts/check-enterprise-imports.mjs test/enterprise/import-boundaries.test.mjs package.json
git commit -m "feat: enforce enterprise import boundaries"
```

## Task 8: Lock The Existing Pi Web Browser Baseline

**Files:**

- Create: `playwright.config.ts`
- Create: `test/enterprise/browser/local-workspace.spec.ts`
- Create: `test/enterprise/browser/local-workspace.spec.ts-snapshots/`
- Create: `test/enterprise/fixtures/pi-agent/.gitkeep`
- Modify: `package.json`

- [ ] **Step 1: Configure Playwright without changing the application**

```ts
import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./test/enterprise/browser",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:30141",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:30141",
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      PI_CODING_AGENT_DIR: resolve("test/enterprise/fixtures/pi-agent"),
      PI_DEPLOYMENT_MODE: "local",
    },
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
```

Add scripts:

```json
{
  "test:e2e": "playwright test",
  "test:e2e:update": "playwright test --update-snapshots"
}
```

- [ ] **Step 2: Write the baseline test**

```ts
import { expect, test } from "@playwright/test";

test("current local workspace remains visually stable", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  await expect(page).toHaveScreenshot("local-workspace.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.01,
  });
});
```

- [ ] **Step 3: Run once and verify the missing-baseline failure**

Run:

```powershell
npx playwright install chromium
npm run test:e2e
```

Expected: FAIL only because approved screenshots do not exist yet. Investigate any application or browser-start failure instead of recording it.

- [ ] **Step 4: Record and verify the approved baselines**

Run:

```powershell
npm run test:e2e:update
npm run test:e2e
```

Expected: screenshots are created for desktop and mobile projects, then the second command passes.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json playwright.config.ts test/enterprise/browser
git commit -m "test: add pi web browser baselines"
```

## Task 9: Final Phase 0A Verification And Handoff

**Files:**

- Create: `docs/enterprise/development.md`
- Create: `.github/workflows/enterprise-foundation.yml`

- [ ] **Step 1: Add the Phase 0A CI workflow**

```yaml
name: enterprise-foundation

on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.19.0
          cache: npm
      - run: npm ci --ignore-scripts
      - run: cp .env.enterprise.example .env.enterprise
      - run: docker compose --env-file .env.enterprise -f compose.enterprise.yml up -d
      - run: npm run check:runtime-versions
      - run: npm run build:enterprise-packages
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:unit
      - run: node --test test/enterprise/*.test.mjs
      - run: npm run test:enterprise-imports
      - run: docker build -f packages/enterprise-worker/Dockerfile -t pi-enterprise-worker:phase0a .
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - if: always()
        run: docker compose --env-file .env.enterprise -f compose.enterprise.yml down
```

- [ ] **Step 2: Document exact development commands and boundaries**

Document:

```text
Required Node version: >=22.19.0
Install: npm install --ignore-scripts
Start local services: docker compose --env-file .env.enterprise.example -f compose.enterprise.yml up -d
Check packages: npm run build:enterprise-packages
Check code: npm run check:enterprise
Browser regression: npm run test:e2e
Runtime Stage A: AgentHarness plus explicit coding tools only
Runtime Stage B: not part of Phase 0A
MinIO: bytes only; PostgreSQL and platform policy remain metadata/authorization authority
```

- [ ] **Step 3: Run fresh complete verification**

Run:

```powershell
npm run check:runtime-versions
npm run build:enterprise-packages
npm run typecheck
npm run lint
npm run test:unit
node --test test/enterprise/*.test.mjs
npm run test:enterprise-imports
docker compose --env-file .env.enterprise.example -f compose.enterprise.yml config --quiet
docker build -f packages/enterprise-worker/Dockerfile -t pi-enterprise-worker:phase0a .
npm run test:e2e
```

Expected: every command exits 0. Do not run `next build`; the repository instructions prohibit it during development.

- [ ] **Step 4: Confirm Phase 0A exit evidence**

Record in the commit message body or PR description:

- Exact Pi version check output.
- Protocol and worker package build output.
- Stage A tool allowlist tests.
- PostgreSQL and MinIO Compose health status.
- Enterprise forbidden-import scan.
- Desktop and mobile Playwright results.
- The remaining Phase 0B requirement: PostgreSQL versioned session broker and restart/conflict integration tests.

- [ ] **Step 5: Commit**

```powershell
git add docs/enterprise/development.md .github/workflows/enterprise-foundation.yml
git commit -m "docs: document enterprise phase 0a workflow"
```

## Follow-Up Plan Sequence

After Phase 0A passes, create and approve these independent plans in order:

1. **Phase 0B: Versioned Session Broker**: PostgreSQL schema, migrations, atomic `appendAndAdvance`, `moveLeaf`, `BrokeredSessionStorage`, stale-version rejection, and restart tests.
2. **Phase 0C: Worker Execution Vertical Slice**: durable job lease, fake-provider Run, event persistence, worker kill/recovery, MinIO artifact commit, and SSE history handoff.
3. **Phase 1A: Identity And Organization Kernel**: OIDC, revocable browser sessions, organization context, RBAC, RLS, and audit foundation.
4. **Phase 1B: Enterprise App Shell**: authenticated App Router layout, route-specific context navigation, local/enterprise build isolation, and extracted chat presentation reducers.
