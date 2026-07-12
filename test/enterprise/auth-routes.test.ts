import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthSession: vi.fn(),
  revokeAuthSession: vi.fn(),
  completeOidcAuthorization: vi.fn(),
  createOidcAuthorizationRequest: vi.fn(),
  db: { query: vi.fn() },
}));

vi.mock("@/lib/enterprise/db", () => ({
  getEnterpriseDb: vi.fn(async () => mocks.db),
  isEnterpriseEnabled: vi.fn(() => true),
}));
vi.mock("@/lib/enterprise/auth-session", () => ({
  createAuthSession: mocks.createAuthSession,
  revokeAuthSession: mocks.revokeAuthSession,
}));
vi.mock("@/lib/enterprise/oidc", () => ({
  completeOidcAuthorization: mocks.completeOidcAuthorization,
  createOidcAuthorizationRequest: mocks.createOidcAuthorizationRequest,
  getOidcPublicOrigin: vi.fn(() => "https://pi.example.test"),
}));

describe("enterprise OIDC routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a browser login to the OIDC authorization endpoint", async () => {
    mocks.createOidcAuthorizationRequest.mockResolvedValue({
      authorizationUrl: "https://identity.example.test/authorize?state=opaque",
    });
    const { GET } = await import("../../app/api/enterprise/v1/auth/login/route");
    const response = await GET(new Request("https://pi.example.test/api/enterprise/v1/auth/login?returnTo=%2Fruns"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://identity.example.test/authorize?state=opaque");
    expect(mocks.createOidcAuthorizationRequest).toHaveBeenCalledWith(
      mocks.db,
      "https://pi.example.test",
      "/runs",
    );
  });

  it("uses the configured public origin when login initialization fails", async () => {
    mocks.createOidcAuthorizationRequest.mockRejectedValue(new Error("discovery unavailable"));
    const { GET } = await import("../../app/api/enterprise/v1/auth/login/route");
    const response = await GET(new Request("https://untrusted-host.test/api/enterprise/v1/auth/login"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://pi.example.test/?authError=oidc_login_failed");
  });

  it("sets an opaque cookie after a successful callback", async () => {
    mocks.completeOidcAuthorization.mockResolvedValue({
      user: { id: "user-1", organizationId: "org-1", roles: ["viewer"] },
      returnTo: "/runs",
    });
    mocks.createAuthSession.mockResolvedValue({
      token: "opaque-browser-session",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const { GET } = await import("../../app/api/enterprise/v1/auth/callback/route");
    const response = await GET(new Request(
      "https://pi.example.test/api/enterprise/v1/auth/callback?code=code-1&state=state-1",
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://pi.example.test/runs");
    expect(response.headers.get("set-cookie")).toContain("pi_enterprise_session=opaque-browser-session");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  });

  it("redirects callback failures to a fixed local error without reflecting provider input", async () => {
    const { GET } = await import("../../app/api/enterprise/v1/auth/callback/route");
    const response = await GET(new Request(
      "https://pi.example.test/api/enterprise/v1/auth/callback?error=access_denied&error_description=secret-provider-text",
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://pi.example.test/?authError=oidc_callback_failed");
    expect(response.headers.get("location")).not.toContain("secret-provider-text");
  });

  it("rejects the legacy bearer-to-cookie endpoint in OIDC mode", async () => {
    const { POST } = await import("../../app/api/enterprise/v1/auth/route");
    const response = await POST(new Request("https://pi.example.test/api/enterprise/v1/auth", {
      method: "POST",
      headers: { Authorization: "Bearer raw-oidc-token" },
    }));
    expect(response.status).toBe(405);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("revokes the server session before clearing the browser cookie", async () => {
    const { DELETE } = await import("../../app/api/enterprise/v1/auth/route");
    const response = await DELETE(new Request("https://pi.example.test/api/enterprise/v1/auth", {
      method: "DELETE",
      headers: { Cookie: "pi_enterprise_session=opaque-browser-session" },
    }));
    expect(response.status).toBe(200);
    expect(mocks.revokeAuthSession).toHaveBeenCalledWith(mocks.db, "opaque-browser-session");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
