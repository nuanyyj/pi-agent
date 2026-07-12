import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { createEnterpriseDatabase, type EnterpriseDatabase } from "../../packages/enterprise-session-broker/src/db";
import {
  completeOidcAuthorization,
  createOidcAuthorizationRequest,
  mapOidcClaims,
  normalizeReturnTo,
  type OidcConfiguration,
} from "../../lib/enterprise/oidc";

const PG_URL =
  process.env.PI_POSTGRES_URL ??
  "postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise";
const origin = "https://pi.example.test";
const issuer = "https://identity.example.test";
const config: OidcConfiguration & { audience: string; clientSecret: string } = {
  issuer,
  clientId: "pi-enterprise",
  clientSecret: "test-client-secret",
  audience: "pi-enterprise-api",
  redirectUri: `${origin}/api/enterprise/v1/auth/callback`,
  rolesClaim: "roles",
  organizationClaim: "org_id",
};

describe("enterprise OIDC", () => {
  let db: EnterpriseDatabase;
  let privateKey: CryptoKey;
  let publicJwk: JWK;
  const createdStates: string[] = [];

  beforeAll(async () => {
    db = await createEnterpriseDatabase(PG_URL);
    const keys = await generateKeyPair("RS256");
    privateKey = keys.privateKey;
    publicJwk = { ...(await exportJWK(keys.publicKey)), kid: "test-key", use: "sig", alg: "RS256" };
  });

  afterAll(async () => {
    if (!db) return;
    if (createdStates.length > 0) {
      await db.query("delete from enterprise_oidc_login_flows where state_hash = any($1::text[])", [createdStates]);
    }
    await db.close();
  });

  it("creates an S256 authorization request and stores only the state hash", async () => {
    const request = await createOidcAuthorizationRequest(db, origin, "/runs?status=active", {
      config,
      fetch: discoveryFetch,
    });
    const url = new URL(request.authorizationUrl);
    const state = url.searchParams.get("state")!;
    createdStates.push(createHash("sha256").update(state).digest("hex"));

    expect(url.origin).toBe(issuer);
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("nonce")).toBeTruthy();

    const stored = await db.query<{ state_hash: string; return_to: string }>(
      "select state_hash, return_to from enterprise_oidc_login_flows where state_hash = $1",
      [createdStates.at(-1)!],
    );
    expect(stored.rows[0]).toEqual({ state_hash: createdStates.at(-1), return_to: "/runs?status=active" });
    expect(stored.rows[0].state_hash).not.toBe(state);
  });

  it("consumes state once and validates ID-token nonce and claims", async () => {
    const request = await createOidcAuthorizationRequest(db, origin, "/", {
      config,
      fetch: discoveryFetch,
    });
    const authUrl = new URL(request.authorizationUrl);
    const state = authUrl.searchParams.get("state")!;
    const nonce = authUrl.searchParams.get("nonce")!;
    createdStates.push(createHash("sha256").update(state).digest("hex"));

    const idToken = await new SignJWT({
      email: "oidc@example.test",
      name: "OIDC User",
      org_id: "org-oidc",
      roles: ["developer"],
      nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("oidc-user")
      .setIssuer(issuer)
      .setAudience(config.clientId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const fetch = oidcFetch(idToken, publicJwk);
    await expect(completeOidcAuthorization(db, { code: "code-1", state, requestOrigin: origin }, { config, fetch }))
      .resolves.toEqual({
        returnTo: "/",
        user: {
          id: "oidc-user",
          email: "oidc@example.test",
          name: "OIDC User",
          organizationId: "org-oidc",
          roles: ["developer"],
        },
      });
    await expect(completeOidcAuthorization(db, { code: "code-1", state, requestOrigin: origin }, { config, fetch }))
      .rejects.toThrow("Invalid or expired OIDC state");
  });

  it("rejects an ID token without the configured organization claim", async () => {
    const request = await createOidcAuthorizationRequest(db, origin, "/", { config, fetch: discoveryFetch });
    const authUrl = new URL(request.authorizationUrl);
    const state = authUrl.searchParams.get("state")!;
    const nonce = authUrl.searchParams.get("nonce")!;
    createdStates.push(createHash("sha256").update(state).digest("hex"));
    const token = await new SignJWT({ roles: ["viewer"], nonce })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("missing-org")
      .setIssuer(issuer)
      .setAudience(config.clientId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(completeOidcAuthorization(
      db,
      { code: "code-2", state, requestOrigin: origin },
      { config, fetch: oidcFetch(token, publicJwk) },
    )).rejects.toThrow("Organization claim required");
  });

  it("normalizes return paths to the current origin", () => {
    expect(normalizeReturnTo("/agents?view=mine")).toBe("/agents?view=mine");
    expect(normalizeReturnTo("https://attacker.test/steal")).toBe("/");
    expect(normalizeReturnTo("//attacker.test/steal")).toBe("/");
    expect(normalizeReturnTo("\\attacker.test/steal")).toBe("/");
  });

  it("maps configurable organization and roles claims consistently", () => {
    expect(mapOidcClaims({
      sub: "user-custom",
      tenant: "org-custom",
      groups: ["admin", 42, "viewer"],
      preferred_username: "Custom User",
    }, {
      ...config,
      organizationClaim: "tenant",
      rolesClaim: "groups",
    })).toEqual({
      id: "user-custom",
      name: "Custom User",
      organizationId: "org-custom",
      roles: ["admin", "viewer"],
    });
  });
});

function discoveryFetch(input: string | URL | Request): Promise<Response> {
  const url = String(input);
  if (url.endsWith("/.well-known/openid-configuration")) {
    return Promise.resolve(Response.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
    }));
  }
  throw new Error(`Unexpected discovery request: ${url}`);
}

function oidcFetch(idToken: string, jwk: JWK): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) return discoveryFetch(input);
    if (url === `${issuer}/token`) {
      expect(init?.method).toBe("POST");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(body.get("client_secret")).toBe(config.clientSecret);
      return Response.json({ token_type: "Bearer", id_token: idToken });
    }
    if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    throw new Error(`Unexpected OIDC request: ${url}`);
  };
}
