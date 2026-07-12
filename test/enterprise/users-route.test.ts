import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = { query: vi.fn(async () => ({ rows: [] })) };
  return {
    tx,
    db: {
      query: vi.fn(async () => ({ rows: [] })),
      transaction: vi.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)),
    },
    revokeAuthSessionsForUser: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/enterprise/db", () => ({
  getEnterpriseDb: vi.fn(async () => mocks.db),
  isEnterpriseEnabled: vi.fn(() => true),
}));
vi.mock("@/lib/enterprise/auth", () => ({
  authenticateRequest: vi.fn(async () => ({
    ok: true,
    user: { id: "admin-1", organizationId: "org-1", roles: ["admin"] },
  })),
}));
vi.mock("@/lib/enterprise/rbac", () => ({
  requirePermission: vi.fn(() => ({ ok: true })),
}));
vi.mock("@/lib/enterprise/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  getClientKey: vi.fn(() => "test-client"),
}));
vi.mock("@/lib/enterprise/request-access", () => ({
  resolveOrganizationAccess: vi.fn(() => ({ ok: true, organizationId: "org-1" })),
}));
vi.mock("@/lib/enterprise/auth-session", () => ({
  revokeAuthSessionsForUser: mocks.revokeAuthSessionsForUser,
}));

describe("enterprise users route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates a user and revokes sessions in one transaction", async () => {
    const { POST } = await import("../../app/api/enterprise/v1/users/route");
    const response = await POST(new Request("https://pi.example.test/api/enterprise/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "user-1", organizationId: "org-1", roles: ["viewer"] }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.query).toHaveBeenCalledTimes(1);
    expect(mocks.db.query).not.toHaveBeenCalled();
    expect(mocks.revokeAuthSessionsForUser).toHaveBeenCalledWith(mocks.tx, "user-1", "org-1");
  });
});
