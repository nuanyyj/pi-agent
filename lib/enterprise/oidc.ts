import { createHash, randomBytes } from "node:crypto";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";
import type { EnterpriseDatabase } from "@pi-web/enterprise-session-broker";
import type { EnterpriseAuthSessionUser } from "./auth-session";

const LOGIN_FLOW_TTL_MS = 10 * 60 * 1000;

export interface OidcConfiguration {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  audience?: string;
  redirectUri: string;
  rolesClaim: string;
  organizationClaim: string;
}

interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface OidcDependencies {
  config?: OidcConfiguration;
  fetch?: typeof fetch;
}

interface ConsumedLoginFlow {
  code_verifier: string;
  nonce: string;
  return_to: string;
}

export function getOidcConfiguration(): OidcConfiguration {
  const issuer = process.env.PI_OIDC_ISSUER?.trim() ?? "";
  const clientId = process.env.PI_OIDC_CLIENT_ID?.trim() ?? "";
  const redirectUri = process.env.PI_OIDC_REDIRECT_URI?.trim() ?? "";
  if (!issuer) throw new Error("PI_OIDC_ISSUER is required");
  if (!clientId) throw new Error("PI_OIDC_CLIENT_ID is required");
  if (!redirectUri) throw new Error("PI_OIDC_REDIRECT_URI is required");

  return {
    issuer: issuer.replace(/\/$/, ""),
    clientId,
    ...(process.env.PI_OIDC_CLIENT_SECRET ? { clientSecret: process.env.PI_OIDC_CLIENT_SECRET } : {}),
    ...(process.env.PI_OIDC_AUDIENCE ? { audience: process.env.PI_OIDC_AUDIENCE } : {}),
    redirectUri,
    rolesClaim: process.env.PI_OIDC_ROLES_CLAIM?.trim() || "roles",
    organizationClaim: process.env.PI_OIDC_ORGANIZATION_CLAIM?.trim() || "org_id",
  };
}

export function getOidcPublicOrigin(config: OidcConfiguration = getOidcConfiguration()): string {
  return new URL(config.redirectUri).origin;
}

export function normalizeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return "/";
  return value;
}

export async function createOidcAuthorizationRequest(
  db: EnterpriseDatabase,
  requestOrigin: string,
  returnTo: string,
  dependencies: OidcDependencies = {},
): Promise<{ authorizationUrl: string }> {
  const config = dependencies.config ?? getOidcConfiguration();
  assertRedirectOrigin(config.redirectUri, requestOrigin);
  const fetcher = dependencies.fetch ?? fetch;
  const metadata = await discover(config, fetcher);
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LOGIN_FLOW_TTL_MS).toISOString();

  await db.query(
    `insert into enterprise_oidc_login_flows
       (state_hash, code_verifier, nonce, return_to, expires_at)
     values ($1, $2, $3, $4, $5::timestamptz)`,
    [hash(state), codeVerifier, nonce, normalizeReturnTo(returnTo), expiresAt],
  );

  const authorizationUrl = new URL(metadata.authorization_endpoint);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid profile email");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", hashBase64Url(codeVerifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  return { authorizationUrl: authorizationUrl.toString() };
}

export async function completeOidcAuthorization(
  db: EnterpriseDatabase,
  input: { code: string; state: string; requestOrigin: string },
  dependencies: OidcDependencies = {},
): Promise<{ user: EnterpriseAuthSessionUser; returnTo: string }> {
  if (!input.code || !input.state) throw new Error("OIDC code and state are required");
  const config = dependencies.config ?? getOidcConfiguration();
  assertRedirectOrigin(config.redirectUri, input.requestOrigin);
  const fetcher = dependencies.fetch ?? fetch;
  const flow = await consumeLoginFlow(db, input.state);
  if (!flow) throw new Error("Invalid or expired OIDC state");
  const metadata = await discover(config, fetcher);

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: flow.code_verifier,
  });
  if (config.clientSecret) tokenBody.set("client_secret", config.clientSecret);

  const tokenResponse = await fetcher(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: tokenBody,
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`OIDC token exchange failed with status ${tokenResponse.status}`);
  const tokens = await tokenResponse.json() as { id_token?: unknown };
  if (typeof tokens.id_token !== "string" || !tokens.id_token) throw new Error("OIDC token response is missing id_token");

  const jwksResponse = await fetcher(metadata.jwks_uri, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!jwksResponse.ok) throw new Error(`OIDC JWKS request failed with status ${jwksResponse.status}`);
  const jwks = await jwksResponse.json() as JSONWebKeySet;
  if (!Array.isArray(jwks.keys)) throw new Error("OIDC JWKS response is invalid");

  const { payload } = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
    issuer: config.issuer,
    audience: config.clientId,
  });
  if (payload.nonce !== flow.nonce) throw new Error("OIDC nonce verification failed");

  return {
    user: mapOidcClaims(payload, config),
    returnTo: normalizeReturnTo(flow.return_to),
  };
}

async function discover(config: OidcConfiguration, fetcher: typeof fetch): Promise<OidcMetadata> {
  const discoveryUrl = `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const response = await fetcher(discoveryUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`OIDC discovery failed with status ${response.status}`);
  const value = await response.json() as Partial<OidcMetadata>;
  if (
    value.issuer !== config.issuer
    || typeof value.authorization_endpoint !== "string"
    || typeof value.token_endpoint !== "string"
    || typeof value.jwks_uri !== "string"
  ) {
    throw new Error("OIDC discovery response is invalid");
  }
  for (const endpoint of [value.authorization_endpoint, value.token_endpoint, value.jwks_uri]) {
    if (new URL(endpoint).protocol !== "https:") throw new Error("OIDC endpoints must use HTTPS");
  }
  return value as OidcMetadata;
}

async function consumeLoginFlow(db: EnterpriseDatabase, state: string): Promise<ConsumedLoginFlow | null> {
  return db.transaction(async (tx) => {
    const result = await tx.query<ConsumedLoginFlow>(
      `update enterprise_oidc_login_flows
       set consumed_at = now()
       where state_hash = $1
         and consumed_at is null
         and expires_at > now()
       returning code_verifier, nonce, return_to`,
      [hash(state)],
    );
    return result.rows[0] ?? null;
  });
}

export function mapOidcClaims(payload: JWTPayload, config: OidcConfiguration): EnterpriseAuthSessionUser {
  if (!payload.sub) throw new Error("OIDC subject claim required");
  const organizationId = payload[config.organizationClaim];
  if (typeof organizationId !== "string" || !organizationId) throw new Error("Organization claim required");
  const rawRoles = payload[config.rolesClaim];
  const roles = Array.isArray(rawRoles)
    ? rawRoles.filter((role): role is string => typeof role === "string")
    : [];
  return {
    id: payload.sub,
    ...(typeof payload.email === "string" ? { email: payload.email } : {}),
    ...(typeof payload.name === "string"
      ? { name: payload.name }
      : typeof payload.preferred_username === "string"
        ? { name: payload.preferred_username }
        : {}),
    organizationId,
    roles,
  };
}

function assertRedirectOrigin(redirectUri: string, requestOrigin: string): void {
  const configured = new URL(redirectUri);
  const request = new URL(requestOrigin);
  if (configured.origin !== request.origin) throw new Error("OIDC redirect URI does not match request origin");
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashBase64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}
