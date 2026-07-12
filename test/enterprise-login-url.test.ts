import { describe, expect, it } from "vitest";
import { buildEnterpriseLoginUrl, normalizeEnterpriseReturnTo } from "../lib/enterprise-login-url";

describe("enterprise login URL", () => {
  it("preserves a local path and query string", () => {
    expect(normalizeEnterpriseReturnTo("/runs?status=active")).toBe("/runs?status=active");
    expect(buildEnterpriseLoginUrl("/runs?status=active")).toBe(
      "/api/enterprise/v1/auth/login?returnTo=%2Fruns%3Fstatus%3Dactive",
    );
  });

  it("rejects external and ambiguous paths", () => {
    for (const value of [
      "https://attacker.test/steal",
      "//attacker.test/steal",
      "\\attacker.test/steal",
      "/\\attacker.test/steal",
    ]) {
      expect(normalizeEnterpriseReturnTo(value)).toBe("/");
      expect(buildEnterpriseLoginUrl(value)).toBe("/api/enterprise/v1/auth/login?returnTo=%2F");
    }
  });
});
