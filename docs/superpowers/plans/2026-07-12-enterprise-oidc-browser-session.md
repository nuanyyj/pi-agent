# Enterprise OIDC Browser Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual browser bearer-token entry and JWT-in-cookie storage with OIDC Authorization Code + PKCE and revocable, opaque, server-side browser sessions.

**Architecture:** Keep JWT verification at the control-plane boundary, but exchange the OIDC authorization code only on the server. Persist short-lived login flows and hashed opaque session tokens in PostgreSQL so multiple Next.js instances share state. Browser APIs authenticate with an HttpOnly session cookie; direct bearer JWTs remain supported for non-browser API clients.

**Tech Stack:** Next.js App Router, TypeScript 5.9, PostgreSQL 17, `jose`, Web Crypto/Node crypto, Vitest.

**Status:** Implemented and verified on 2026-07-12. The checklist below records the completed TDD and verification steps.

---

### Task 1: Add PostgreSQL authentication session storage

**Files:**
- Modify: `packages/enterprise-session-broker/src/db.ts`
- Create: `lib/enterprise/auth-session.ts`
- Create: `test/enterprise/auth-session.test.ts`

- [x] **Step 1: Write failing tests for opaque sessions**

Test that `createAuthSession()` returns a raw token once, stores only its SHA-256 hash, `findAuthSession()` rejects expired/revoked rows, and `revokeAuthSession()` invalidates the current token. Use an injected `EnterpriseDatabase` and a real PostgreSQL integration case for schema coverage.

- [x] **Step 2: Verify RED**

Run:

```powershell
$env:PI_POSTGRES_URL = "postgres://pi_enterprise:replace-for-local-development@127.0.0.1:25432/pi_enterprise"
npx vitest run test/enterprise/auth-session.test.ts -v
```

Expected: FAIL because the table and session-store API do not exist.

- [x] **Step 3: Add schema and focused session API**

Add `enterprise_auth_sessions` with `token_hash`, identity claims, timestamps, and revocation fields. Expose:

```ts
export interface EnterpriseAuthSessionUser {
  id: string;
  email?: string;
  name?: string;
  organizationId: string;
  roles: string[];
}

export async function createAuthSession(
  db: EnterpriseDatabase,
  user: EnterpriseAuthSessionUser,
  options?: { ttlSeconds?: number },
): Promise<{ token: string; expiresAt: string }>;

export async function findAuthSession(
  db: EnterpriseDatabase,
  token: string,
): Promise<EnterpriseAuthSessionUser | null>;

export async function revokeAuthSession(
  db: EnterpriseDatabase,
  token: string,
): Promise<void>;
```

Generate 32 random bytes, encode base64url, hash with SHA-256 before persistence, use constant data types, and never log or return the hash.

- [x] **Step 4: Verify GREEN**

Run the Task 1 test command and expect all tests to pass.

### Task 2: Add durable OIDC discovery and PKCE login flows

**Files:**
- Create: `lib/enterprise/oidc.ts`
- Create: `test/enterprise/oidc.test.ts`
- Modify: `packages/enterprise-session-broker/src/db.ts`

- [x] **Step 1: Write failing tests for discovery, PKCE, state and callback validation**

Cover issuer metadata validation, safe same-origin `returnTo`, S256 challenge generation, one-time state consumption, expired state rejection, token endpoint errors, ID-token nonce verification, required organization claim, and roles claim mapping. Inject `fetch` into the exchange function; use a locally signed test JWT rather than a network identity provider.

- [x] **Step 2: Verify RED**

Run `npx vitest run test/enterprise/oidc.test.ts -v` and expect missing-module failures.

- [x] **Step 3: Implement the OIDC service**

Add `enterprise_oidc_login_flows` with `state_hash`, `code_verifier`, `nonce`, `return_to`, `expires_at`, and `consumed_at`. Implement:

```ts
export async function createOidcAuthorizationRequest(
  db: EnterpriseDatabase,
  requestOrigin: string,
  returnTo: string,
): Promise<{ authorizationUrl: string }>;

export async function completeOidcAuthorization(
  db: EnterpriseDatabase,
  input: { code: string; state: string; requestOrigin: string },
): Promise<{ user: EnterpriseAuthSessionUser; returnTo: string }>;
```

Require `PI_OIDC_ISSUER`, `PI_OIDC_CLIENT_ID`, and an allowlisted redirect URI. Support an optional client secret only at the token endpoint. Never send provider tokens to the browser or persist them in business tables.

- [x] **Step 4: Verify GREEN**

Run the focused OIDC tests and expect all cases to pass.

### Task 3: Wire login, callback and revocable authentication

**Files:**
- Create: `app/api/enterprise/v1/auth/login/route.ts`
- Create: `app/api/enterprise/v1/auth/callback/route.ts`
- Modify: `app/api/enterprise/v1/auth/route.ts`
- Modify: `lib/enterprise/auth.ts`
- Create: `test/enterprise/auth-request.test.ts`

- [x] **Step 1: Write failing request-authentication tests**

Prove that an opaque cookie resolves through PostgreSQL, an expired/revoked cookie returns 401, direct bearer JWT validation still works, logout revokes the server row, and callback failures redirect to a fixed local error path without reflecting provider text.

- [x] **Step 2: Verify RED**

Run `npx vitest run test/enterprise/auth-request.test.ts -v` and expect opaque-cookie authentication to fail.

- [x] **Step 3: Implement routes and middleware changes**

`GET /auth/login` starts PKCE and redirects to the provider. `GET /auth/callback` consumes state, exchanges the code, creates an opaque session, sets `pi_enterprise_session`, and redirects to the validated local path. `DELETE /auth` revokes the current server-side session before clearing the cookie. Set `HttpOnly`, `SameSite=Lax` for the OIDC redirect round-trip, `Secure` in production, a bounded `Max-Age`, and `Path=/`.

- [x] **Step 4: Verify GREEN**

Run the focused auth tests and expect all cases to pass.

### Task 4: Replace manual OIDC token entry with SSO navigation

**Files:**
- Modify: `hooks/useEnterpriseAuth.tsx`
- Modify: `docs/enterprise/development.md`
- Modify: `.env.enterprise.example`

- [x] **Step 1: Add a failing frontend login URL behavior test**

Create `lib/enterprise-login-url.ts` and `test/enterprise-login-url.test.ts`. Test that the helper preserves a local path plus query string and replaces absolute, protocol-relative, or backslash-prefixed input with `/`. Keep the React component thin.

- [x] **Step 2: Implement the login experience**

In OIDC mode render a `Sign in with SSO` command that navigates to `/api/enterprise/v1/auth/login?returnTo=...`; do not render a token input. Keep token input only for explicit development token mode. Logout awaits the server response before clearing client state.

- [x] **Step 3: Document deployment configuration**

Document `PI_OIDC_CLIENT_ID`, optional `PI_OIDC_CLIENT_SECRET`, redirect URI, issuer/audience/roles/org claim requirements, cookie security, and local IdP callback setup.

### Task 5: Verify and publish

**Files:**
- Modify: only files required by failing checks

- [ ] **Step 1: Run focused PostgreSQL tests**

```powershell
$env:PI_POSTGRES_URL = "postgres://pi_enterprise:replace-for-local-development@127.0.0.1:25432/pi_enterprise"
npx vitest run test/enterprise/auth-session.test.ts test/enterprise/oidc.test.ts test/enterprise/auth-request.test.ts -v
```

- [ ] **Step 2: Run enterprise gates**

```powershell
$env:PI_POSTGRES_URL = "postgres://pi_enterprise:replace-for-local-development@127.0.0.1:25432/pi_enterprise"
npm run check:enterprise
```

- [ ] **Step 3: Inspect and publish**

Run `git diff --check`, inspect the staged diff and secret scan, commit with `feat(enterprise): add revocable OIDC browser sessions`, and push `feat/enterprise-phase-0a-pr`. Do not stage the unrelated `app/globals.css` line-ending state.
